# MCP `structuredContent` research

Research checked 2026-09-25. The protocol, MCP Apps, and host products do not
give exactly the same meaning to the two result channels. The safe server
shape for a result that must work in text-only clients and MCP Apps is:

```ts
return {
  content: [
    { type: "text", text: "Short human-readable summary." },
    { type: "text", text: JSON.stringify(data) },
  ],
  structuredContent: data,
};
```

This preserves the full text fallback and gives clients a JSON value without
requiring them to parse prose. A summary alone would lose the detailed result
in clients that only consume `content`. Hosts may expose both representations
to the model, so this compatibility choice can increase context usage.

## Protocol behavior

The MCP 2026-07-28 server-tools specification makes `outputSchema` optional.
When a tool advertises one, `structuredContent` is the value that must match
that schema; it is not the schema for the whole `CallToolResult`. The same
release widened the value from an object to any JSON value. Servers should
still include a serialized text representation for older clients and hosts
that do not consume structured output.

Source: [MCP server tools, Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content)

`outputSchema` is therefore useful even though it is optional: it documents the
return contract, lets clients validate the result, and gives models/tool
wrappers a shape to reason about. Returning `structuredContent` without an
`outputSchema` is legal, but clients cannot validate the shape from the tool
descriptor.

## What hosts do with the fields

| Host or specification                | `content`                                                                       | `structuredContent`                                        | Consequence                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP Apps stable spec (2026-01-26)    | Model context and text-only fallback                                            | Structured data for UI rendering                           | The app receives both in `ui/notifications/tool-result`; the spec says structured data is not added to model context.                                                              |
| MCP Apps draft                       | Result for model context                                                        | Optional structured data for UI                            | The draft keeps the same split and adds negotiated structured-content support.                                                                                                     |
| ChatGPT/OpenAI Apps                  | Model and component                                                             | Model and component; exposed as `window.openai.toolOutput` | OpenAI explicitly recommends declaring `outputSchema`; `_meta` is component-only.                                                                                                  |
| Claude official tool-design guidance | Claude reads `content[].text`                                                   | Clients may validate typed output                          | Anthropic recommends always including a text fallback because some hosts do not read structured output.                                                                            |
| VS Code                              | Both are shown when both are returned in the historical interoperability report | Preferred for model context in that report                 | Issue #297669 reports a crash for structured-only results in the output view. This is version-specific evidence, not a current support guarantee.                                  |
| Claude Code                          | Behavior is host/version dependent                                              | Reports show it can take precedence and suppress `content` | Do not put important model-only prose solely in `content` if the full structured value omits it; keep the structured value self-describing when Claude Code compatibility matters. |

Sources:

- [MCP Apps stable specification: tool-result data passing and best practices](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#data-passing)
- [MCP Apps draft: tool-result data passing and best practices](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#data-passing)
- [OpenAI Plugins reference: tool results](https://developers.openai.com/plugins/reference#tool-results)
- [Anthropic official MCP server tool-design guidance: structured output](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/mcp-server-dev/skills/build-mcp-server/references/tool-design.md#structured-output)
- [VS Code issue: structured-only result breaks the output view](https://github.com/microsoft/vscode/issues/297669)
- [MCP SEP-1624: historical report of differing client precedence](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624)
- [Claude Code issue: `content[].text` dropped when structured content is present](https://github.com/anthropics/claude-code/issues/55677)

The VS Code and Claude Code issue reports are evidence of behavior in specific
versions, not protocol requirements. They are useful compatibility warnings,
not guarantees about every current release.

## `_meta` is a separate visibility channel

For MCP Apps, `_meta` is passed to the UI and is not intended for model
context. OpenAI states this more directly: only `content` and
`structuredContent` appear in the conversation transcript, while result
`_meta` is delivered only to the component. Put widget-only hydration data or
data that the model must never see in `_meta`, subject to the host's security
and size limits. Do not use `_meta` as the compatibility fallback for data the
model needs.

Sources:

- [MCP Apps stable specification: `content`, `structuredContent`, and `_meta`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#data-passing)
- [OpenAI Plugins reference: tool results and visibility](https://developers.openai.com/plugins/reference#tool-results)

## Recommendation for this project

Model-facing data tools return explicit `content` and `structuredContent`.
Keep the summary and serialized JSON in `content`, since scene IDs, patch
results, and snapshot IDs must survive hosts that only pass text to the model.
Array results use named object fields: raw scenes use `{ elements }`, snapshot
lists use `{ snapshots }`, and template lists use `{ templates }`. These
objects also work with the older protocol, which required object roots.

Keep the app-only `render_scene` shape `{ name, url, elements }`: the view in
`src/view/main.ts` already reads `res.structuredContent` directly. Its short
`content` summary stays unchanged. Screenshots remain native image content.

The installed `@modelcontextprotocol/server` 2.1.0 only adds an automatic JSON
text fallback for non-object structured values without an existing text block
(`appendTextFallbackForNonObject` in its wire codec). It does not supplement
our object results or summaries, so the handlers include JSON explicitly.

No `outputSchema` is added in this change. Structured values are legal without
it, but their shapes are not validated against a declared output contract.
Registering Zod input schemas does not also validate outputs. That would need
separate output schemas; it does not need a custom error guard.

Source for older object-only behavior:
[MCP 2025-06-18 structured content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content)
