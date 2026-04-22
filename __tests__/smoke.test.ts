// ---------------------------------------------------------------------------
// Smoke tests — exercise the pure functions without needing a running pi.
// Run with: npx tsx __tests__/smoke.test.ts
// No test framework; plain assertions + exit code.
//
// Note: resolveOutboundName is called only from the gated (Claude
// anthropic-messages) path. The tests below assume that gate and assert
// the gated behavior. The gate itself is tested separately via
// isClaudeAnthropicMessages.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import {
	CC_CANONICAL_NAMES,
	DEFAULT_MCP_PREFIX,
	PI_TO_CC_CANONICAL,
	resolveOutboundName,
} from "../extensions/core-tools.js";
import {
	buildReverseMap,
	lookupReverse,
	renameToolCallsInPlace,
} from "../extensions/inbound.js";
import { isClaudeAnthropicMessages } from "../extensions/index.js";
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

// --- resolveOutboundName -----------------------------------------------

console.log("resolveOutboundName (gated/Claude path):");

test("pi core tools canonicalize (read → Read, bash → Bash, ...)", () => {
	assert.equal(resolveOutboundName("read"), "Read");
	assert.equal(resolveOutboundName("write"), "Write");
	assert.equal(resolveOutboundName("bash"), "Bash");
	assert.equal(resolveOutboundName("grep"), "Grep");
});

test("edit has no PI_TO_CC_CANONICAL mapping → mcp__pi__edit", () => {
	// pi's edit schema differs from CC's canonical Edit, so we do NOT
	// canonicalize it; instead it goes through the mcp__pi__ default.
	assert.equal(resolveOutboundName("edit"), "mcp__pi__edit");
});

test("exact canonical names pass through unchanged", () => {
	assert.equal(resolveOutboundName("Read"), "Read");
	assert.equal(resolveOutboundName("Bash"), "Bash");
	assert.equal(resolveOutboundName("Agent"), "Agent"); // @tintinweb/pi-subagents
	assert.equal(resolveOutboundName("AskUserQuestion"), "AskUserQuestion");
	assert.equal(resolveOutboundName("WebFetch"), "WebFetch");
});

test("already mcp__-prefixed passes through", () => {
	assert.equal(resolveOutboundName("mcp__exa__web_search"), "mcp__exa__web_search");
	assert.equal(resolveOutboundName("mcp__pi__foo"), "mcp__pi__foo");
});

test("FLAT_TO_MCP companions map to canonical MCP alias", () => {
	assert.equal(resolveOutboundName("web_search_exa"), "mcp__exa__web_search");
	assert.equal(resolveOutboundName("firecrawl_scrape"), "mcp__firecrawl__scrape");
	assert.equal(resolveOutboundName("generate_image"), "mcp__antigravity__generate_image");
});

test("custom pi tools get mcp__pi__ prefix", () => {
	assert.equal(resolveOutboundName("ask_user"), "mcp__pi__ask_user");
	assert.equal(resolveOutboundName("subagent"), "mcp__pi__subagent");
	assert.equal(resolveOutboundName("web_search"), "mcp__pi__web_search");
	assert.equal(resolveOutboundName("fetch_content"), "mcp__pi__fetch_content");
	assert.equal(resolveOutboundName("flow_write"), "mcp__pi__flow_write");
	assert.equal(resolveOutboundName("agent_write"), "mcp__pi__agent_write");
	assert.equal(resolveOutboundName("finish"), "mcp__pi__finish");
	assert.equal(resolveOutboundName("get_subagent_result"), "mcp__pi__get_subagent_result");
});

test("exported constants are populated", () => {
	assert.ok(CC_CANONICAL_NAMES.has("Read"));
	assert.ok(CC_CANONICAL_NAMES.has("Agent"));
	assert.ok(CC_CANONICAL_NAMES.has("WebSearch"));
	assert.ok(!CC_CANONICAL_NAMES.has("read")); // case-sensitive
	assert.equal(PI_TO_CC_CANONICAL.get("read"), "Read");
	assert.equal(PI_TO_CC_CANONICAL.get("bash"), "Bash");
	assert.equal(DEFAULT_MCP_PREFIX, "mcp__pi__");
});

// --- isClaudeAnthropicMessages gate -----------------------------------

console.log("\nisClaudeAnthropicMessages (single gate):");

test("opens for Claude model on anthropic-messages", () => {
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "claude-opus-4-6" } }),
		true,
	);
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "9Router/cc/claude-sonnet-4" } }),
		true,
	);
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "anthropic/claude-haiku-4-5" } }),
		true,
	);
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "CLAUDE-SONNET-4" } }), // case-insensitive
		true,
	);
});

test("closes for non-Claude anthropic-messages", () => {
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "glm-5" } }),
		false,
	);
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "9Router/gemini/gemini-3-pro-preview" } }),
		false,
	);
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "gpt-5" } }),
		false,
	);
});

test("closes for non-anthropic-messages api", () => {
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "openai-completions", id: "gpt-5" } }),
		false,
	);
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "google-generative-ai", id: "gemini-2.5-pro" } }),
		false,
	);
	// Claude name but wrong api
	assert.equal(
		isClaudeAnthropicMessages({ model: { api: "openai-completions", id: "claude-via-proxy" } }),
		false,
	);
});

test("closes for missing ctx/model", () => {
	assert.equal(isClaudeAnthropicMessages(undefined), false);
	assert.equal(isClaudeAnthropicMessages({}), false);
	assert.equal(isClaudeAnthropicMessages({ model: undefined }), false);
	assert.equal(isClaudeAnthropicMessages({ model: { api: "anthropic-messages" } }), false); // no id
});

test("FORCE_CANONICAL opens the gate for any anthropic-messages session", () => {
	const prev = process.env.PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL;
	process.env.PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL = "1";
	try {
		assert.equal(
			isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "glm-5" } }),
			true,
		);
		// But still requires anthropic-messages api
		assert.equal(
			isClaudeAnthropicMessages({ model: { api: "openai-completions", id: "claude-via-proxy" } }),
			false,
		);
	} finally {
		if (prev === undefined) delete process.env.PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL;
		else process.env.PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL = prev;
	}
});

test("DISABLE_CANONICAL closes the gate for any session", () => {
	const prev = process.env.PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL;
	process.env.PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL = "1";
	try {
		assert.equal(
			isClaudeAnthropicMessages({ model: { api: "anthropic-messages", id: "claude-opus-4-6" } }),
			false,
		);
	} finally {
		if (prev === undefined) delete process.env.PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL;
		else process.env.PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL = prev;
	}
});

// --- transformPayload --------------------------------------------------

console.log("\ntransformPayload (gated session):");

test("canonicalizes pi core tools and prefixes custom ones", () => {
	const raw = {
		tools: [
			{ name: "read", description: "…", input_schema: {} },
			{ name: "write", description: "…", input_schema: {} },
			{ name: "bash", description: "…", input_schema: {} },
			{ name: "grep", description: "…", input_schema: {} },
			{ name: "edit", description: "…", input_schema: {} },
			{ name: "ask_user", description: "…", input_schema: {} },
			{ name: "subagent", description: "…", input_schema: {} },
			{ name: "Agent", description: "…", input_schema: {} },
			{ name: "mcp__exa__web_search", description: "…", input_schema: {} },
		],
	};
	const { payload, nameMap } = transformPayload(raw, resolveOutboundName);
	const names = (payload.tools as Array<{ name: string }>).map((t) => t.name);
	assert.deepEqual(names, [
		"Read",
		"Write",
		"Bash",
		"Grep",
		"mcp__pi__edit",
		"mcp__pi__ask_user",
		"mcp__pi__subagent",
		"Agent",
		"mcp__exa__web_search",
	]);
	assert.equal(nameMap.get("read"), "Read");
	assert.equal(nameMap.get("bash"), "Bash");
	assert.equal(nameMap.get("ask_user"), "mcp__pi__ask_user");
	assert.equal(nameMap.has("Agent"), false); // unchanged
});

test("idempotent when pi-ai OAuth already canonicalized", () => {
	// pi-ai's OAuth path rewrites read → Read before our bridge runs. Our
	// exact-match against CC_CANONICAL_NAMES finds Read and passes it
	// through unchanged — no double rename.
	const raw = {
		tools: [
			{ name: "Read", description: "…", input_schema: {} },
			{ name: "Bash", description: "…", input_schema: {} },
		],
	};
	const { payload, nameMap } = transformPayload(raw, resolveOutboundName);
	const names = (payload.tools as Array<{ name: string }>).map((t) => t.name);
	assert.deepEqual(names, ["Read", "Bash"]);
	assert.equal(nameMap.size, 0);
});

test("rewrites historical tool_use / tool_result blocks", () => {
	const raw = {
		tools: [
			{ name: "bash", description: "…", input_schema: {} },
			{ name: "ask_user", description: "…", input_schema: {} },
		],
		messages: [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "hello" },
					{ type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
					{ type: "tool_use", id: "t2", name: "ask_user", input: { q: "?" } },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: "x", name: "bash" },
					{ type: "tool_result", tool_use_id: "t2", content: "y", name: "ask_user" },
				],
			},
		],
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	type Block = Record<string, unknown>;
	const asst = (payload.messages as Array<{ role: string; content: Block[] }>)[0];
	assert.equal(asst.content[1].name, "Bash");
	assert.equal(asst.content[2].name, "mcp__pi__ask_user");
	const user = (payload.messages as Array<{ role: string; content: Block[] }>)[1];
	assert.equal(user.content[0].name, "Bash");
	assert.equal(user.content[1].name, "mcp__pi__ask_user");
});

test("rewrites tool_choice when pointing at a renamed tool", () => {
	const raw = {
		tools: [{ name: "ask_user", description: "…", input_schema: {} }],
		tool_choice: { type: "tool", name: "ask_user" },
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	assert.equal((payload.tool_choice as { name: string }).name, "mcp__pi__ask_user");
});

test("does not mutate input payload", () => {
	const raw = {
		tools: [
			{ name: "ask_user", description: "…", input_schema: {} },
			{ name: "bash", description: "…", input_schema: {} },
		],
	};
	const clone = JSON.parse(JSON.stringify(raw));
	transformPayload(raw, resolveOutboundName);
	assert.deepEqual(raw, clone);
});

test("rewrites system prompt pi phrases", () => {
	const raw = {
		system: "You are Claude Code, Anthropic's official CLI for Claude. Always read pi .md files completely (pi packages matter). Pi itself is...",
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	assert.ok(typeof payload.system === "string");
	const s = payload.system as string;
	assert.ok(!s.includes("Always read pi .md"));
	assert.ok(!s.includes("pi packages"));
	assert.ok(s.includes("cli .md"));
	assert.ok(s.includes("cli packages"));
});

test("rewrites structured system blocks", () => {
	const raw = {
		system: [
			{ type: "text", text: "pi itself provides..." },
			{ type: "text", text: "second block, no pi phrases" },
		],
	};
	const { payload } = transformPayload(raw, resolveOutboundName);
	const blocks = payload.system as Array<{ type: string; text: string }>;
	assert.ok(blocks[0].text.includes("the cli itself"));
	assert.equal(blocks[1].text, "second block, no pi phrases");
});

// --- buildReverseMap + lookupReverse + renameToolCallsInPlace ----------

console.log("\nbuildReverseMap + lookupReverse + renameToolCallsInPlace:");

test("reverse map includes canonical → pi entries", () => {
	const reverse = buildReverseMap(["read", "write", "bash", "grep", "ask_user"]);
	assert.equal(reverse.get("Read"), "read");
	assert.equal(reverse.get("Write"), "write");
	assert.equal(reverse.get("Bash"), "bash");
	assert.equal(reverse.get("Grep"), "grep");
});

test("reverse map includes mcp__pi__<name> → <name> entries", () => {
	const reverse = buildReverseMap(["ask_user", "subagent", "flow_write"]);
	assert.equal(reverse.get("mcp__pi__ask_user"), "ask_user");
	assert.equal(reverse.get("mcp__pi__subagent"), "subagent");
	assert.equal(reverse.get("mcp__pi__flow_write"), "flow_write");
});

test("reverse map includes FLAT_TO_MCP inverse entries", () => {
	const reverse = buildReverseMap(["web_search_exa", "firecrawl_scrape"]);
	assert.equal(reverse.get("mcp__exa__web_search"), "web_search_exa");
	assert.equal(reverse.get("mcp__firecrawl__scrape"), "firecrawl_scrape");
});

test("lookupReverse finds exact match", () => {
	const reverse = buildReverseMap(["ask_user"]);
	assert.equal(lookupReverse("mcp__pi__ask_user", reverse), "ask_user");
});

test("lookupReverse is case-insensitive", () => {
	const reverse = buildReverseMap(["ask_user"]);
	assert.equal(lookupReverse("MCP__PI__ASK_USER", reverse), "ask_user");
});

test("lookupReverse strips _ide suffix (canonical)", () => {
	const reverse = buildReverseMap(["read"]);
	assert.equal(lookupReverse("Read_ide", reverse), "read");
});

test("lookupReverse strips _ide suffix (mcp-prefixed)", () => {
	const reverse = buildReverseMap(["web_search"]);
	assert.equal(lookupReverse("mcp__pi__web_search_ide", reverse), "web_search");
});

test("lookupReverse returns undefined for genuine misses", () => {
	const reverse = buildReverseMap(["ask_user"]);
	assert.equal(lookupReverse("something_weird", reverse), undefined);
	assert.equal(lookupReverse("something_weird_ide", reverse), undefined);
});

test("renameToolCallsInPlace renames mcp-prefixed tool calls", () => {
	const registered = ["ask_user", "subagent", "flow_write", "read", "bash"];
	const reverse = buildReverseMap(registered);
	const msg = {
		content: [
			{ type: "text", text: "hi" },
			{ type: "toolCall", id: "1", name: "mcp__pi__ask_user", arguments: { q: "?" } },
			{ type: "toolCall", id: "2", name: "mcp__pi__subagent", arguments: {} },
			{ type: "toolCall", id: "3", name: "Bash", arguments: { command: "ls" } }, // canonical reverse
		],
	};
	const changed = renameToolCallsInPlace(msg, reverse);
	assert.equal(changed, true);
	assert.equal((msg.content[1] as { name: string }).name, "ask_user");
	assert.equal((msg.content[2] as { name: string }).name, "subagent");
	assert.equal((msg.content[3] as { name: string }).name, "bash");
});

test("renameToolCallsInPlace handles _ide mangling", () => {
	const reverse = buildReverseMap(["web_search", "read"]);
	const msg = {
		content: [
			{ type: "toolCall", id: "1", name: "mcp__pi__web_search_ide", arguments: {} },
			{ type: "toolCall", id: "2", name: "Read_ide", arguments: { path: "/x" } },
		],
	};
	const changed = renameToolCallsInPlace(msg, reverse);
	assert.equal(changed, true);
	assert.equal((msg.content[0] as { name: string }).name, "web_search");
	assert.equal((msg.content[1] as { name: string }).name, "read");
});

test("renameToolCallsInPlace is a no-op when no matches", () => {
	const reverse = buildReverseMap(["ask_user"]);
	const msg = {
		content: [
			{ type: "toolCall", id: "1", name: "something_weird", arguments: {} },
			{ type: "toolCall", id: "2", name: "ask_user", arguments: {} }, // already pi name, no entry in reverse
		],
	};
	const changed = renameToolCallsInPlace(msg, reverse);
	assert.equal(changed, false);
	assert.equal((msg.content[0] as { name: string }).name, "something_weird");
	assert.equal((msg.content[1] as { name: string }).name, "ask_user");
});

// --- canonical-passthrough reverse coverage (fix-canonical-inbound-reverse-map) ----
//
// When an extension registers a tool directly under a Claude Code canonical
// name (e.g. @tintinweb/pi-subagents registers "Agent"), the outbound
// transform passes the name through unchanged. Claude Code's endpoint still
// mangles it to "<name>_ide" in responses, so lookupReverse must be able to
// strip the suffix and resolve back to the canonical (now-registered) name.
// Without an identity entry in the reverse map, pi's dispatch fails with
// "Tool Agent_ide not found".

console.log("\ncanonical-passthrough reverse coverage:");

test("Agent_ide maps back to canonically-registered Agent", () => {
	const reverse = buildReverseMap(["Agent", "bash", "read"]);
	assert.equal(lookupReverse("Agent_ide", reverse), "Agent");
});

test("AskUserQuestion_ide maps back to canonically-registered AskUserQuestion", () => {
	const reverse = buildReverseMap(["AskUserQuestion", "bash"]);
	assert.equal(lookupReverse("AskUserQuestion_ide", reverse), "AskUserQuestion");
});

test("bare canonical name (no _ide) resolves when registered canonically", () => {
	const reverse = buildReverseMap(["Agent"]);
	assert.equal(lookupReverse("Agent", reverse), "Agent");
});

test("lowercase core registration still uses PI_TO_CC_CANONICAL (no clobber)", () => {
	// Only "read" is registered, not "Read". The canonical-identity loop
	// must NOT write Read → Read here, which would mask the correct
	// PI_TO_CC_CANONICAL routing Read → read.
	const reverse = buildReverseMap(["read"]);
	assert.equal(lookupReverse("Read_ide", reverse), "read");
	assert.equal(lookupReverse("Read", reverse), "read");
});

test("canonical core registration routes to itself (not the pi lowercase)", () => {
	// Only "Read" is registered (unusual but legal). The canonical-identity
	// loop must win and route Read → Read so dispatch finds the registered
	// canonical handler.
	const reverse = buildReverseMap(["Read"]);
	assert.equal(lookupReverse("Read_ide", reverse), "Read");
	assert.equal(lookupReverse("Read", reverse), "Read");
});

test("canonical identity is scoped to registered tools only", () => {
	// Task is in CC_CANONICAL_NAMES but NOT in registeredToolNames.
	// There must be no identity entry for it — otherwise dispatch would
	// silently route to a non-existent handler instead of failing cleanly.
	const reverse = buildReverseMap(["bash", "read"]);
	assert.equal(lookupReverse("Task_ide", reverse), undefined);
	assert.equal(lookupReverse("Task", reverse), undefined);
});
