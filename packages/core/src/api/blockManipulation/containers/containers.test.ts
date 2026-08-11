import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test";

import { BlockNoteSchema } from "../../../blocks/BlockNoteSchema.js";
import { defaultBlockSpecs } from "../../../blocks/defaultBlocks.js";
import { BlockNoteEditor } from "../../../editor/BlockNoteEditor.js";
import { createBlockSpec } from "../../../schema/blocks/createSpec.js";

// A vanilla (non-React) container block accepting any children, with
// defaultChildren seeding — the callout from the container-block example.
const Callout = createBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      flavor: {
        default: "tip",
        values: ["tip", "info", "warning", "success"],
      },
    },
    content: "none",
    childBlocks: {
      min: 1,
      defaultChildren: [{ type: "paragraph" }],
    },
  },
  {
    render: (block) => {
      const dom = document.createElement("div");
      dom.className = "callout";
      dom.setAttribute("data-node-type", "callout");
      dom.setAttribute("data-id", block.id);
      return { dom, contentDOM: dom };
    },
  },
)();

// A container that never exits on Enter (like columns).
const LockedBox = createBlockSpec(
  {
    type: "lockedBox" as const,
    propSchema: {},
    content: "none",
    childBlocks: { min: 1 },
  },
  {
    meta: {
      exitOnEnter: false,
    },
    render: (block) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-node-type", "lockedBox");
      dom.setAttribute("data-id", block.id);
      return { dom, contentDOM: dom };
    },
  },
)();

// A columnList-like pair: a horizontal container restricted to `gridCell`
// children (min 2) with column-style repair, and a non-top-level cell.
// Proves the "custom table-like structure" story is buildable.
const Grid = createBlockSpec(
  {
    type: "grid" as const,
    propSchema: {},
    content: "none",
    childBlocks: {
      allowedBlocks: ["gridCell"],
      min: 2,
      collapseWhenEmptied: true,
    },
  },
  {
    render: (block) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-node-type", "grid");
      dom.setAttribute("data-id", block.id);
      dom.style.display = "flex";
      return { dom, contentDOM: dom };
    },
  },
)();

const GridCell = createBlockSpec(
  {
    type: "gridCell" as const,
    propSchema: {},
    content: "none",
    childBlocks: { topLevel: false },
  },
  {
    render: (block) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-node-type", "gridCell");
      dom.setAttribute("data-id", block.id);
      return { dom, contentDOM: dom };
    },
  },
)();

const schema = BlockNoteSchema.create().extend({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: Callout,
    lockedBox: LockedBox,
    grid: Grid,
    gridCell: GridCell,
  } as const,
});

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
    { id: "p-0", type: "paragraph", content: "Paragraph 0" },
    { id: "p-1", type: "paragraph", content: "Paragraph 1" },
  ]);
});

function pressKey(key: string, keyCode: number) {
  const view = editor._tiptapEditor.view;
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    keyCode,
    bubbles: true,
  });
  view.someProp("handleKeyDown", (f: any) => f(view, event));
}

describe("childBlocks insertion & seeding", () => {
  it("seeds defaultChildren when inserted without children", () => {
    editor.insertBlocks([{ type: "callout", id: "c-0" }], "p-1", "after");

    const callout = editor.getBlock("c-0")!;
    expect(callout.children).toHaveLength(1);
    expect(callout.children[0].type).toBe("paragraph");
  });

  it("seeds defaultChildren when converting a block via updateBlock", () => {
    editor.updateBlock("p-1", { type: "callout" });

    const callout = editor.document[1];
    expect(callout.type).toBe("callout");
    expect(callout.children).toHaveLength(1);
    expect(callout.children[0].type).toBe("paragraph");
  });

  it("accepts arbitrary block children, including nested containers", () => {
    editor.insertBlocks(
      [
        {
          type: "callout",
          id: "c-0",
          children: [
            { type: "heading", content: "In callout" },
            {
              type: "callout",
              id: "c-1",
              children: [{ type: "paragraph", content: "Nested" }],
            },
          ],
        },
      ],
      "p-1",
      "after",
    );

    const callout = editor.getBlock("c-0")!;
    expect(callout.children.map((child) => child.type)).toEqual([
      "heading",
      "callout",
    ]);
    expect(editor.getBlock("c-1")!.children[0].type).toBe("paragraph");
  });

  it("rejects non-allowed children for a restricted container", () => {
    expect(() =>
      editor.insertBlocks(
        [
          {
            type: "grid",
            children: [
              { type: "paragraph", content: "not a cell" },
              { type: "paragraph", content: "not a cell" },
            ],
          },
        ],
        "p-1",
        "after",
      ),
    ).toThrow();
  });

  it("accepts allowed children for a restricted container", () => {
    editor.insertBlocks(
      [
        {
          type: "grid",
          id: "g-0",
          children: [
            {
              type: "gridCell",
              children: [{ type: "paragraph", content: "Cell A" }],
            },
            {
              type: "gridCell",
              children: [{ type: "paragraph", content: "Cell B" }],
            },
          ],
        },
      ],
      "p-1",
      "after",
    );

    const grid = editor.getBlock("g-0")!;
    expect(grid.children.map((child) => child.type)).toEqual([
      "gridCell",
      "gridCell",
    ]);
  });

  it("rejects inserting a topLevel: false container at the document root", () => {
    expect(() =>
      editor.insertBlocks(
        [{ type: "gridCell", children: [{ type: "paragraph" }] }],
        "p-1",
        "after",
      ),
    ).toThrow();
  });
});

describe("childBlocks keyboard handling", () => {
  it("Enter on an empty last child escapes the container", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "callout",
        id: "c-0",
        children: [
          { id: "c-p-0", type: "paragraph", content: "Hello" },
          { id: "c-p-1", type: "paragraph", content: "" },
        ],
      },
      { id: "trailing", type: "paragraph", content: "" },
    ]);
    editor.setTextCursorPosition("c-p-1", "end");

    pressKey("Enter", 13);

    expect(editor.document).toMatchSnapshot();
    // The empty block has moved out of the callout.
    const callout = editor.getBlock("c-0")!;
    expect(callout.children.map((child) => child.id)).toEqual(["c-p-0"]);
    expect(editor.document.map((block) => block.type)).toEqual([
      "callout",
      "paragraph",
      "paragraph",
    ]);
  });

  it("Enter does not escape a container with meta.exitOnEnter: false", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "lockedBox",
        id: "l-0",
        children: [
          { id: "l-p-0", type: "paragraph", content: "Hello" },
          { id: "l-p-1", type: "paragraph", content: "" },
        ],
      },
      { id: "trailing", type: "paragraph", content: "" },
    ]);
    editor.setTextCursorPosition("l-p-1", "end");

    pressKey("Enter", 13);

    // Still exactly one top-level lockedBox followed by the trailing
    // paragraph; the new block was created inside the container.
    expect(editor.document.map((block) => block.type)).toEqual([
      "lockedBox",
      "paragraph",
    ]);
    expect(editor.getBlock("l-0")!.children.length).toBeGreaterThanOrEqual(2);
  });

  it("Backspace at the start of a container's first child moves it out", () => {
    editor.replaceBlocks(editor.document, [
      { id: "before", type: "paragraph", content: "Before" },
      {
        type: "callout",
        id: "c-0",
        children: [
          { id: "c-p-0", type: "paragraph", content: "First" },
          { id: "c-p-1", type: "paragraph", content: "Second" },
        ],
      },
    ]);
    editor.setTextCursorPosition("c-p-0", "start");

    pressKey("Backspace", 8);

    expect(editor.document).toMatchSnapshot();
    // The first child has moved out, above the callout.
    expect(editor.getBlock("c-0")!.children.map((child) => child.id)).toEqual([
      "c-p-1",
    ]);
    expect(editor.document.map((block) => block.id)[1]).toBe("c-p-0");
  });

  it("Backspace at the start of a block after a container moves it inside", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "callout",
        id: "c-0",
        children: [{ id: "c-p-0", type: "paragraph", content: "In callout" }],
      },
      { id: "after", type: "paragraph", content: "After" },
    ]);
    editor.setTextCursorPosition("after", "start");

    pressKey("Backspace", 8);

    expect(editor.document).toMatchSnapshot();
    expect(editor.getBlock("c-0")!.children.map((child) => child.id)).toEqual([
      "c-p-0",
      "after",
    ]);
  });

  it("Delete at the end of a block before a container pulls its first child out", () => {
    editor.replaceBlocks(editor.document, [
      { id: "before", type: "paragraph", content: "Before" },
      {
        type: "callout",
        id: "c-0",
        children: [
          { id: "c-p-0", type: "paragraph", content: "First" },
          { id: "c-p-1", type: "paragraph", content: "Second" },
        ],
      },
    ]);
    editor.setTextCursorPosition("before", "end");

    pressKey("Delete", 46);

    expect(editor.document).toMatchSnapshot();
    expect(editor.document.map((block) => block.id).slice(0, 2)).toEqual([
      "before",
      "c-p-0",
    ]);
    expect(editor.getBlock("c-0")!.children.map((child) => child.id)).toEqual([
      "c-p-1",
    ]);
  });

  it("Delete at the end of a container's last child pulls the next block in", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "callout",
        id: "c-0",
        children: [{ id: "c-p-0", type: "paragraph", content: "In callout" }],
      },
      { id: "after", type: "paragraph", content: "After" },
    ]);
    editor.setTextCursorPosition("c-p-0", "end");

    pressKey("Delete", 46);

    expect(editor.document).toMatchSnapshot();
    expect(editor.getBlock("c-0")!.children.map((child) => child.id)).toEqual([
      "c-p-0",
      "after",
    ]);
  });
});

describe("childBlocks repair", () => {
  it("keeps a default container when its only child is removed (refilled)", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "callout",
        id: "c-0",
        children: [{ id: "c-p-0", type: "paragraph", content: "Only child" }],
      },
      { id: "trailing", type: "paragraph", content: "" },
    ]);

    editor.removeBlocks(["c-p-0"]);

    const callout = editor.getBlock("c-0")!;
    expect(callout).toBeDefined();
    expect(callout.children).toHaveLength(1);
    expect(callout.children[0].type).toBe("paragraph");
    expect(callout.children[0].content).toEqual([]);
  });

  it("unwraps a repair-configured container when only one non-empty child remains", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "grid",
        id: "g-0",
        children: [
          {
            type: "gridCell",
            id: "cell-a",
            children: [{ id: "cell-a-p", type: "paragraph", content: "A" }],
          },
          {
            type: "gridCell",
            id: "cell-b",
            children: [{ id: "cell-b-p", type: "paragraph", content: "B" }],
          },
        ],
      },
      { id: "trailing", type: "paragraph", content: "" },
    ]);

    editor.removeBlocks(["cell-a-p"]);

    expect(editor.document).toMatchSnapshot();
    // The grid has been unwrapped: cell B's content replaced it.
    expect(editor.getBlock("g-0")).toBeUndefined();
    expect(editor.document.map((block) => block.id)).toEqual([
      "cell-b-p",
      "trailing",
    ]);
  });
});

describe("childBlocks selection & conversion", () => {
  it("getSelectionCutBlocks handles selections reaching into a container", () => {
    editor.replaceBlocks(editor.document, [
      { id: "before", type: "paragraph", content: "Before" },
      {
        type: "callout",
        id: "c-0",
        children: [
          { id: "c-p-0", type: "paragraph", content: "First" },
          { id: "c-p-1", type: "paragraph", content: "Second" },
        ],
      },
    ]);
    editor.setSelection("before", "c-p-0");

    // Previously threw "unexpected" for any partial selection touching a
    // container (breaking comments/AI selection handling).
    const result = editor.getSelectionCutBlocks();
    expect(result.blocks.length).toBeGreaterThanOrEqual(1);
    expect(result.blocks.map((block) => block.id)).toContain("before");
  });

  it("round-trips a container through full (internal) HTML", async () => {
    const blocks = [
      {
        type: "callout" as const,
        id: "c-0",
        props: { flavor: "warning" as const },
        children: [
          { id: "c-p-0", type: "paragraph" as const, content: "In callout" },
        ],
      },
    ];
    editor.replaceBlocks(editor.document, blocks);

    const html = editor.blocksToFullHTML(editor.document);
    expect(html).toContain('data-node-type="callout"');

    const parsed = editor.tryParseHTMLToBlocks(html);
    expect(parsed[0].type).toBe("callout");
    expect((parsed[0].props as any).flavor).toBe("warning");
    expect(parsed[0].children).toHaveLength(1);
    expect(parsed[0].children[0].type).toBe("paragraph");
  });

  it("exports containers to external HTML with type + prop attributes", async () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "callout",
        id: "c-0",
        props: { flavor: "warning" },
        children: [{ id: "c-p-0", type: "paragraph", content: "In callout" }],
      },
    ]);

    const html = editor.blocksToHTMLLossy(editor.document);
    expect(html).toContain('data-node-type="callout"');
    expect(html).toContain('data-flavor="warning"');
    // Container output is not wrapped in a blockContent div.
    expect(html).not.toContain("bn-block-content");
  });

  it("flattens containers to their children in markdown export", async () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "callout",
        id: "c-0",
        children: [
          { id: "c-p-0", type: "paragraph", content: "In callout" },
          { id: "c-p-1", type: "heading", content: "Heading in callout" },
        ],
      },
    ]);

    const markdown = editor.blocksToMarkdownLossy(editor.document);
    expect(markdown).toContain("In callout");
    expect(markdown).toContain("# Heading in callout");
  });
});
