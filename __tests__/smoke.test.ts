// ---------------------------------------------------------------------------
// Smoke tests — exercise the pure functions without needing a running pi.
// Run with: npx tsx __tests__/smoke.test.ts
// No test framework; plain assertions + exit code.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { resolveOutboundName } from "../extensions/core-tools.js";
import { buildReverseMap, renameToolCallsInPlace } from "../extensions/inbound.js";
import { transformPayload } from "../extensions/transform.js";

function test(name: string, fn: () => void): void {
	try {
		fn();
		console.log(`  ok  ${name}`);
	} catch (err) {
		console.error(`  FAIL ${name}`);
		console.error((err as Error).message);
		process.exitCode = 1;
	}
}

console.log("resolveOutboundName:");

test("core tools pass through", () => {
	assert.equal(resolveOutboundName("Read"), "Read");
	assert.equal(resolveOutboundName("bash"), "bash");
	assert.equal(resolveOutboundName("AskUserQuestion"), "AskUserQuestion");
});

test("already mcp__ passes through", () => {
	assert.equal(resolveOutboundName("mcp__exa__web_search"), "mcp__exa__web_search");
});

test("known FLAT_TO_MCP companion maps to canonical alias", () => {
	assert.equal(resolveOutboundName("web_search_exa"), "mcp__exa__web_search");
	assert.equal(resolveOutboundName("firecrawl_scrape"), "mcp__firecrawl__scrape");
});

test("unknown custom tool gets mcp__ prefix", () => {
	assert.equal(resolveOutboundName("ask_user"), "mcp__ask_user");
	assert.equal(resolveOutboundName("subagent"), "mcp__subagent");
	assert.equal(resolveOutboundName("flow_write"), "mcp__flow_write");
	assert.equal(resolveOutboundName("agent_write"), "mcp__agent_write");
	assert.equal(resolveOutboundName("finish"), "mcp__finish");
});

console.log("\ntransformPayload:");

test("rewrites tools[].name for custom tools", () => {
	const raw = {
		tools: [
			{ name: "Read", description: "…", input_schema: {} },
			{ name: "bash", description: "…", input_schema: {} },
			{ name: "ask_user", description: "…", input_schema: {} },
			{ name: "subagent", description: "…", input_schema: {} },
			{ name: "mcp__exa__web_search", description: "…", input_schema: {} },
		],
	};
	const { payload, nameMap } = transformPayload(raw, resolveOutboundName);
	const names = (payload.tools as Array<{ name: string }>).map((t) => t.name);
	assert.deepEqual(names, [
		"Read",
		"bash",
		"mcp__ask_user",
		"mcp__subagent",
		"mcp__exa__web_search",
	]);
	assert.equal(nameMap.get("ask_user"), "mcp__ask_user");
	assert.equal(nameMap.get("subagent"), "mcp__subagent");
});

test("rewrites historical tool_use blocks in messages", () => {
	const raw = {
		tools: [{ name: "ask_user", description: "…", input_schema: {} }],
		messages: [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "hello" },
					{ type: "tool_use", id: "t1", name: "ask_user", input: { q: "?" } },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: "x", name: "ask_user" },
				],
			},
		],
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	const asst = (payload.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>)[0];
	assert.equal(asst.content[1].name, "mcp__ask_user");
	const user = (payload.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>)[1];
	assert.equal(user.content[0].name, "mcp__ask_user");
});

test("rewrites tool_choice when pointing at a renamed tool", () => {
	const raw = {
		tools: [{ name: "ask_user", description: "…", input_schema: {} }],
		tool_choice: { type: "tool", name: "ask_user" },
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	assert.equal((payload.tool_choice as { name: string }).name, "mcp__ask_user");
});

test("does not mutate input", () => {
	const raw = {
		tools: [{ name: "ask_user", description: "…", input_schema: {} }],
	};
	const clone = JSON.parse(JSON.stringify(raw));
	transformPayload(raw, resolveOutboundName);
	assert.deepEqual(raw, clone);
});

test("rewrites system-prompt pi strings", () => {
	const raw = {
		system: "You are Claude Code, Anthropic's official CLI for Claude. Pi documentation... read cli .md files completely (was pi .md files). Always read pi .md files completely.",
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	assert.ok(typeof payload.system === "string");
	assert.ok(!(payload.system as string).includes("Always read pi .md"));
});

console.log("\nbuildReverseMap + renameToolCallsInPlace:");

test("inbound rename reverses mcp__ prefix", () => {
	const registered = ["ask_user", "subagent", "flow_write", "read", "bash"];
	const reverse = buildReverseMap(registered);
	assert.equal(reverse.get("mcp__ask_user"), "ask_user");
	assert.equal(reverse.get("mcp__subagent"), "subagent");
	assert.equal(reverse.get("mcp__flow_write"), "flow_write");

	const msg = {
		content: [
			{ type: "text", text: "hi" },
			{ type: "toolCall", id: "1", name: "mcp__ask_user", arguments: { q: "?" } },
			{ type: "toolCall", id: "2", name: "mcp__subagent", arguments: {} },
			{ type: "toolCall", id: "3", name: "bash", arguments: {} }, // core, leave
		],
	};
	const changed = renameToolCallsInPlace(msg, reverse);
	assert.equal(changed, true);
	assert.equal((msg.content[1] as { name: string }).name, "ask_user");
	assert.equal((msg.content[2] as { name: string }).name, "subagent");
	assert.equal((msg.content[3] as { name: string }).name, "bash");
});

test("inbound rename reverses FLAT_TO_MCP companions", () => {
	const registered = ["web_search_exa", "read"];
	const reverse = buildReverseMap(registered);
	const msg = {
		content: [
			{ type: "toolCall", id: "1", name: "mcp__exa__web_search", arguments: {} },
		],
	};
	renameToolCallsInPlace(msg, reverse);
	assert.equal((msg.content[0] as { name: string }).name, "web_search_exa");
});

test("inbound rename is a no-op for unrecognized names", () => {
	const reverse = buildReverseMap(["ask_user"]);
	const msg = {
		content: [{ type: "toolCall", id: "1", name: "something_weird", arguments: {} }],
	};
	const changed = renameToolCallsInPlace(msg, reverse);
	assert.equal(changed, false);
	assert.equal((msg.content[0] as { name: string }).name, "something_weird");
});
