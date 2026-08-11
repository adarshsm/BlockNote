# Container Block

In this example, we create a custom `Callout` block that holds **other blocks** as its body — like a Notion-style callout that can wrap a paragraph followed by a code block, or any combination of nested blocks.

The block uses the new `childBlocks` config on `BlockConfig`. Setting `childBlocks: { defaultChildren: [{ type: "paragraph" }] }` (with `content: "none"`) tells BlockNote to emit a ProseMirror node that holds nested block children directly — the same shape that columns use under the hood. The contained blocks live on `block.children` at runtime.

The callout also has an editable **title**, demonstrating the complementary "string prop slot" pattern: content that doesn't need rich text, comments, or multiplayer cursors can live in a plain string prop, edited through a regular `<input>` rendered inside the block (in a `contentEditable={false}` wrapper) and committed via `editor.updateBlock`.

We also wire up a Slash Menu item to insert the callout, and render the document JSON next to the editor so you can inspect the structure of the nested blocks.

**Try it out:**

- Press the "/" key inside the callout's body and add a code block, heading, or list — anything goes.
- Type a title into the title field — it's stored on `block.props.title`, not as document content.
- Watch the JSON panel on the right update as you edit; the callout's children appear in `block.children`.
- Insert a new callout via the Slash Menu (search "callout").

**Relevant Docs:**

- [Custom Blocks](/docs/features/custom-schemas/custom-blocks)
- [Editor Setup](/docs/getting-started/editor-setup)
