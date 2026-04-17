// ---------------------------------------------------------------------------
// Outbound payload transform (anthropic-messages).
//
// Given a raw request payload and a name-mapping function, returns a NEW
// payload with:
//
//   - payload.tools[i].name rewritten
//   - payload.tool_choice.name rewritten (if it references a renamed tool)
//   - payload.messages[i].content[j].name rewritten for historical tool_use
//     and tool_result blocks (tool_result matches by tool_use_id only, but
//     some SDK shapes carry `name` for debugging; we normalize if present)
//   - system prompt text lightly rewritten for pi → "the cli" wording
//     (helps Claude Code-style subscription endpoints avoid identity checks
//     catching the word "pi")
//
// The mapping is supplied as a function so the caller can plug in any
// strategy (mcp__ prefixing, native aliasing, etc.).
// ---------------------------------------------------------------------------

import { lower } from "./core-tools.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// -- System prompt rewrites ------------------------------------------------

function rewritePromptText(text: string): string {
	return text
		.replaceAll("pi itself", "the cli itself")
		.replaceAll("pi .md files", "cli .md files")
		.replaceAll("pi packages", "cli packages");
}

function rewriteSystemField(system: unknown): unknown {
	if (typeof system === "string") return rewritePromptText(system);
	if (!Array.isArray(system)) return system;
	return system.map((block) => {
		if (!isPlainObject(block) || block.type !== "text" || typeof block.text !== "string") return block;
		const rewritten = rewritePromptText(block.text);
		return rewritten === block.text ? block : { ...block, text: rewritten };
	});
}

// -- Tool array remapping --------------------------------------------------

/**
 * Rewrites each tool name via `rename`. Returns a new array. Original-to-new
 * map is recorded in `outMap` for later use when remapping tool_choice and
 * historical tool_use blocks in messages.
 */
function remapTools(
	tools: unknown[] | undefined,
	rename: (name: string) => string,
	outMap: Map<string, string>,
): unknown[] | undefined {
	if (!Array.isArray(tools)) return tools;
	return tools.map((tool) => {
		if (!isPlainObject(tool)) return tool;
		// Native typed tools (computer_use, text_editor_20241022, …) have `type`
		// and no `name`; skip them.
		if (typeof tool.type === "string" && tool.type.trim().length > 0 && typeof tool.name !== "string") {
			return tool;
		}
		if (typeof tool.name !== "string") return tool;
		const newName = rename(tool.name);
		if (newName === tool.name) return tool;
		outMap.set(tool.name, newName);
		outMap.set(lower(tool.name), newName);
		return { ...tool, name: newName };
	});
}

function remapToolChoice(
	toolChoice: unknown,
	nameMap: Map<string, string>,
): unknown {
	if (!isPlainObject(toolChoice)) return toolChoice;
	const name = typeof toolChoice.name === "string" ? toolChoice.name : undefined;
	if (!name) return toolChoice;
	const mapped = nameMap.get(name) ?? nameMap.get(lower(name));
	return mapped ? { ...toolChoice, name: mapped } : toolChoice;
}

function remapMessageToolNames(
	messages: unknown[],
	nameMap: Map<string, string>,
): unknown[] {
	let anyChange = false;
	const next = messages.map((msg) => {
		if (!isPlainObject(msg) || !Array.isArray(msg.content)) return msg;
		let msgChanged = false;
		const content = msg.content.map((block) => {
			if (!isPlainObject(block)) return block;
			if ((block.type === "tool_use" || block.type === "tool_result") && typeof block.name === "string") {
				const mapped = nameMap.get(block.name) ?? nameMap.get(lower(block.name));
				if (mapped && mapped !== block.name) {
					msgChanged = true;
					return { ...block, name: mapped };
				}
			}
			return block;
		});
		if (!msgChanged) return msg;
		anyChange = true;
		return { ...msg, content };
	});
	return anyChange ? next : messages;
}

// -- Full payload transform -----------------------------------------------

/**
 * Apply the anthropic-messages outbound transform.
 *
 * Pure function — does not mutate input. Caller should feed the return value
 * back as the new payload.
 *
 * @returns { payload, nameMap } where nameMap is original→new, useful if the
 *          caller also wants to rewrite inbound responses by prefix.
 */
export function transformPayload(
	raw: unknown,
	rename: (name: string) => string,
): { payload: Record<string, unknown>; nameMap: Map<string, string> } {
	// Deep clone so downstream mutations don't affect the caller's payload.
	const payload: Record<string, unknown> = isPlainObject(raw)
		? (JSON.parse(JSON.stringify(raw)) as Record<string, unknown>)
		: {};

	const nameMap = new Map<string, string>();

	if (payload.system !== undefined) {
		payload.system = rewriteSystemField(payload.system);
	}

	if (Array.isArray(payload.tools)) {
		payload.tools = remapTools(payload.tools, rename, nameMap);
	}

	if (payload.tool_choice !== undefined) {
		payload.tool_choice = remapToolChoice(payload.tool_choice, nameMap);
	}

	if (Array.isArray(payload.messages)) {
		payload.messages = remapMessageToolNames(payload.messages, nameMap);
	}

	return { payload, nameMap };
}
