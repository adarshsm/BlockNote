import { createBlockSpec } from "@blocknote/core";

import { ColumnResizeExtension } from "../../extensions/ColumnResize/ColumnResizeExtension.js";
import { MultiColumnDropHandlerExtension } from "../../extensions/DropCursor/multiColumnHandleDropPlugin.js";

// Why does each column have a default width of 1, i.e. 100%? Because when
// creating a new column, we want to make sure that existing column widths are
// preserved, while the new one also has a sensible width. If we set it so all
// column widths must add up to 100% instead, then each time a new column is
// created, we'd have to assign it a width depending on the total number of
// columns and also adjust the widths of the others. The same can be said for
// using px instead of percent widths and making them add to the editor width.
// Using flex-grow on the value handles all the resizing for us, instead of
// manually having to set `width` on each column.
const COLUMN_WIDTH_DEFAULT = 1;

export const ColumnBlock = createBlockSpec(
  {
    type: "column" as const,
    propSchema: {
      width: {
        default: COLUMN_WIDTH_DEFAULT,
      },
    },
    content: "none",
    // Columns only ever live inside a `columnList` (whose content expression
    // is `column column+`). `topLevel: false` keeps column out of the
    // generic `blockGroupChild` group so it can't be inserted at the document
    // root or as a child of any other block.
    childBlocks: { topLevel: false },
  },
  {
    meta: {
      // Enter on an empty last block stays inside the column (the generic
      // container default would move it out below the columnList).
      exitOnEnter: false,
      // Columns are never dragged individually — whole columnLists are
      // rearranged via column-specific drag handling instead.
      draggable: false,
    },
    render: (block) => {
      const dom = document.createElement("div");
      dom.className = "bn-block-column";
      const width = block.props.width ?? COLUMN_WIDTH_DEFAULT;
      dom.style.flexGrow = String(width);
      dom.setAttribute("data-node-type", "column");
      dom.setAttribute("data-id", block.id);
      if (width !== COLUMN_WIDTH_DEFAULT) {
        dom.setAttribute("data-width", String(width));
      }

      return {
        dom,
        contentDOM: dom,
        update: (newNode: {
          type: { name: string };
          attrs: { id?: string; width?: number };
        }) => {
          if (newNode.type.name !== "column") {
            return false;
          }
          const newWidth = newNode.attrs.width ?? COLUMN_WIDTH_DEFAULT;
          dom.style.flexGrow = String(newWidth);
          if (newWidth !== COLUMN_WIDTH_DEFAULT) {
            dom.setAttribute("data-width", String(newWidth));
          } else {
            dom.removeAttribute("data-width");
          }
          if (newNode.attrs.id) {
            dom.setAttribute("data-id", newNode.attrs.id);
          } else {
            dom.removeAttribute("data-id");
          }
          return true;
        },
      };
    },
  },
  [MultiColumnDropHandlerExtension(), ColumnResizeExtension()],
)();

export const ColumnListBlock = createBlockSpec(
  {
    type: "columnList" as const,
    propSchema: {},
    content: "none",
    // Generates the `column{2,}` content expression (equivalent to the
    // previous hand-written node's `column column+`) and drives the generic
    // container machinery: emptied columns are removed on repair, and a
    // columnList left with fewer than two non-empty columns is replaced by
    // the surviving column's content.
    childBlocks: {
      allowedBlocks: ["column"],
      min: 2,
      collapseWhenEmptied: true,
    },
  },
  {
    meta: {
      // Preserved from the hand-written ColumnList node (which used the PM
      // default); container blocks otherwise default to `isolating: true`.
      isolating: false,
      // Whole-columnList dragging stays disabled (matches previous
      // behavior; columns are rearranged via column-specific drag handling).
      draggable: false,
      // Enter on an empty last block stays inside the column list's columns.
      exitOnEnter: false,
    },
    render: (block) => {
      const dom = document.createElement("div");
      dom.className = "bn-block-column-list";
      dom.setAttribute("data-node-type", "columnList");
      dom.setAttribute("data-id", block.id);
      dom.style.display = "flex";

      return {
        dom,
        contentDOM: dom,
        update: (newNode: {
          type: { name: string };
          attrs: { id?: string };
        }) => {
          if (newNode.type.name !== "columnList") {
            return false;
          }
          if (newNode.attrs.id) {
            dom.setAttribute("data-id", newNode.attrs.id);
          } else {
            dom.removeAttribute("data-id");
          }
          return true;
        },
      };
    },
  },
)();
