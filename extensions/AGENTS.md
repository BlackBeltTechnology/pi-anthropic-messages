# DOX — extensions

Files in this area. Purposes left for the agent to author.

| File | Purpose |
|---|---|
| `core-tools.ts` | Canonical tool-name sets/maps: `CC_CANONICAL_NAMES`, `PI_TO_CC_CANONICAL`, `FLAT_TO_MCP`, `NATIVE_ALIASES`, `DEFAULT_MCP_PREFIX=mcp__pi__`. `resolveOutboundName(name)` picks wire name. |
| `inbound.ts` | Inbound tool-call rename. `buildReverseMap(names)`, `lookupReverse(name,map)` (strips `_ide`), `renameToolCallsInPlace(msg,map)` on message_end. |
| `index.ts` | Entry `default piAnthropicMessages(pi)`. `isAnthropicMessagesGated` gate (anthropic-messages api; env FORCE/DISABLE_CANONICAL). Hooks outbound/inbound. No logging (0.3.5). |
| `transform.ts` | Pure outbound payload rewrite `transformPayload(raw, rename)` → `{payload,nameMap}`. Renames tools, tool_choice, tool_use/tool_result names; pi→"the cli" in system text. |
