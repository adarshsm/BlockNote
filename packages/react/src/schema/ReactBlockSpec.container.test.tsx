import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
} from "@blocknote/core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test";

import { createReactBlockSpec } from "./ReactBlockSpec.js";

// Same shape as the example callout block (`examples/06-custom-schema/09-container-block`).
// This test exists to confirm the document-level transformation succeeds — it
// does NOT mount BlockNoteView, so React rendering of the nodeView itself is
// not exercised here.
const Callout = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: {},
    content: "none" as const,
    childBlocks: { min: 1, defaultChildren: [{ type: "paragraph" }] },
  },
  {
    render: ({ contentRef }) => (
      <div className="callout">
        <div className="callout-body" ref={contentRef} />
      </div>
    ),
  },
)();

const schema = BlockNoteSchema.create().extend({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: Callout,
  } as const,
});

describe("React updateBlock → container with defaultChildren (document-level)", () => {
  let editor: BlockNoteEditor<
    typeof schema.blockSchema,
    typeof schema.inlineContentSchema,
    typeof schema.styleSchema
  >;
  const div = document.createElement("div");

  beforeAll(() => {
    document.body.appendChild(div);
    editor = BlockNoteEditor.create({ schema });
    editor.mount(div);
  });

  afterAll(() => {
    editor._tiptapEditor.destroy();
    div.remove();
    editor = undefined as any;
  });

  beforeEach(() => {
    editor.replaceBlocks(editor.document, [
      { id: "p-0", type: "paragraph", content: "" },
      { id: "trailing", type: "paragraph", content: "" },
    ]);
  });

  it("converts an empty paragraph to a callout via editor.updateBlock", () => {
    editor.updateBlock("p-0", { type: "callout" });
    expect(editor.document).toMatchSnapshot();
  }, 5000);

  it("does not wrap containers in a blockContent div in external HTML", async () => {
    // A separate, unmounted (headless) editor: the React external-HTML path
    // renders through a temporary root in headless mode.
    const headlessEditor = BlockNoteEditor.create({ schema });

    const html = headlessEditor.blocksToHTMLLossy([
      {
        type: "callout",
        id: "c-0",
        children: [{ id: "c-p-0", type: "paragraph", content: "Hello" }],
      },
    ] as any);
    // Container blocks own their outer DOM entirely — regression test for
    // the React `toExternalHTML` path wrapping them in a spurious
    // `bn-block-content` div (core's `createBlockSpec` passes them through).
    expect(html).not.toContain('data-content-type="callout"');
    expect(html).toContain('data-node-type="callout"');
    expect(html).toContain("Hello");
  }, 5000);
});
