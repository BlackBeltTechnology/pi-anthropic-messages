# Inbound Reverse Mapping

## Purpose

Defines the contract for the bridge's inbound tool-name reverse map: the table that converts endpoint-visible tool names back to the pi-registered names pi's dispatcher expects. The reverse map is the inverse of every outbound name transformation applied by `resolveOutboundName` and must be round-trip-complete for every registration style used by pi extensions. Without a complete inverse, responses from Claude Code's anthropic-messages endpoint (which appends an `_ide` suffix to tool names) cannot be routed to their original handlers and pi reports "Tool <name>_ide not found".

This capability covers only the gated path (Claude model on `anthropic-messages` API). On non-gated sessions the reverse map is not constructed and this capability has no effect.

## Requirements

### Requirement: Reverse map covers all outbound name transformations

The bridge SHALL build a reverse lookup map that, for every outbound name transformation applied by `resolveOutboundName`, contains an inverse entry mapping the outbound (wire-visible) name back to the original pi-registered tool name. The map SHALL cover all six outbound routing cases: canonical passthrough, already-MCP-prefixed passthrough, native aliases, flat-to-MCP aliases, pi-to-canonical capitalization, and default `mcp__pi__` prefixing.

#### Scenario: Lowercase pi core tool registered and outbound-canonicalized

- **WHEN** a session has registered tool `bash` and the outbound transform rewrites it to `Bash`
- **THEN** the reverse map contains `Bash → bash` and `bash → bash`
- **AND** `lookupReverse("Bash")` returns `"bash"`
- **AND** `lookupReverse("Bash_ide")` returns `"bash"` (after `_ide` strip)

#### Scenario: Tool registered directly under a canonical name

- **WHEN** a session has registered tool `Agent` (exact-case canonical, e.g. from pi-subagents)
- **AND** the outbound transform passes `Agent` through unchanged
- **THEN** the reverse map contains `Agent → Agent`
- **AND** `lookupReverse("Agent")` returns `"Agent"`
- **AND** `lookupReverse("Agent_ide")` returns `"Agent"` (after `_ide` strip)

#### Scenario: Custom pi tool prefixed via default MCP namespace

- **WHEN** a session has registered tool `browser` and the outbound transform rewrites it to `mcp__pi__browser`
- **THEN** the reverse map contains `mcp__pi__browser → browser`
- **AND** `lookupReverse("mcp__pi__browser")` returns `"browser"`
- **AND** `lookupReverse("mcp__pi__browser_ide")` returns `"browser"` (after `_ide` strip)

#### Scenario: Flat-named companion tool aliased to third-party MCP

- **WHEN** the session has registered tool `web_search_exa` and `FLAT_TO_MCP` maps it to `mcp__exa__web_search`
- **THEN** the reverse map contains `mcp__exa__web_search → web_search_exa`
- **AND** `lookupReverse("mcp__exa__web_search")` returns `"web_search_exa"`

### Requirement: Reverse map entries are scoped to currently-registered tools

The reverse map SHALL only contain entries whose target is a tool name present in the session's `pi.getAllTools()` output at the time the map is built. The map MUST NOT route mangled names to tools that don't exist locally, even if the outbound transform would have produced them for registered tools in past sessions.

#### Scenario: Canonical tool not registered in current session

- **WHEN** a session has registered tools `["bash", "read"]` but does not have `Agent`
- **AND** the assistant message contains a historical `tool_use` block with name `"Agent_ide"` (from a prior session where Agent was registered)
- **THEN** `lookupReverse("Agent_ide")` returns `undefined`
- **AND** `renameToolCallsInPlace` leaves the block name as `"Agent_ide"` unchanged
- **AND** pi's dispatcher correctly reports the tool as unavailable

#### Scenario: Canonical identity only populated for registered canonical names

- **WHEN** the reverse map is built from `registeredToolNames = ["Agent", "bash", "read"]`
- **THEN** the map contains identity entries for `Agent` (it is canonical and registered)
- **AND** the map does NOT contain identity entries for `Task`, `AskUserQuestion`, `WebSearch`, etc. (canonical but not registered)

### Requirement: Canonical identity mapping does not clobber pi-lowercase mappings

When both `PI_TO_CC_CANONICAL` and the canonical-identity loop apply to the same canonical key, the mapping SHALL reflect the actual registered tool name. If `read` (lowercase) is registered, the reverse map SHALL contain `Read → read`. If `Read` (canonical) is registered, the reverse map SHALL contain `Read → Read`. The outcome SHALL match whichever form appears in `registeredToolNames`.

#### Scenario: Lowercase registration preserves PI_TO_CC_CANONICAL routing

- **WHEN** the session has registered tool `read` (lowercase) but NOT `Read` (canonical)
- **THEN** `lookupReverse("Read")` returns `"read"`
- **AND** `lookupReverse("Read_ide")` returns `"read"`

#### Scenario: Canonical registration wins when that's what's registered

- **WHEN** the session has registered tool `Read` (canonical) but NOT `read` (lowercase)
- **THEN** `lookupReverse("Read")` returns `"Read"`
- **AND** `lookupReverse("Read_ide")` returns `"Read"`

### Requirement: Reverse lookup handles `_ide` suffix mangling

The `lookupReverse` function SHALL tolerate the `_ide` suffix that Claude Code's endpoint appends to every tool name in responses. When an exact-name lookup fails, the function SHALL strip a trailing `_ide` and retry the lookup (both exact-case and lowercase) before returning undefined.

#### Scenario: Endpoint appends `_ide` to canonical tool names

- **WHEN** the model emits a `tool_use` block with name `"Agent_ide"` and `Agent` is registered
- **THEN** `lookupReverse` strips `_ide` to `"Agent"`, finds the identity entry, and returns `"Agent"`
- **AND** `renameToolCallsInPlace` rewrites the block name to `"Agent"`
- **AND** pi's dispatcher successfully routes to the `Agent` handler

#### Scenario: Endpoint appends `_ide` to `mcp__pi__`-prefixed tool names

- **WHEN** the model emits a `tool_use` block with name `"mcp__pi__browser_ide"` and `browser` is registered
- **THEN** `lookupReverse` strips `_ide` to `"mcp__pi__browser"`, finds the `DEFAULT_MCP_PREFIX` inverse, and returns `"browser"`
- **AND** the block name is rewritten to `"browser"`

#### Scenario: Endpoint emits canonical name without `_ide` suffix

- **WHEN** the model emits a `tool_use` block with name `"Agent"` (not mangled) and `Agent` is registered
- **THEN** `lookupReverse` returns `"Agent"` on the exact-case lookup without needing the `_ide` strip path
