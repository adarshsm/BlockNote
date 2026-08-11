import { describe, expect, it } from "vite-plus/test";

import type { ContainerUIInfo } from "../../api/blockManipulation/containers/containerUI.js";
import {
  getContainerChildAtCursor,
  getDirectChildBlocks,
  hasHorizontalContainerAncestor,
  isHorizontalContainer,
} from "./sideMenuContainerGeometry.js";

// jsdom does no layout, so `getBoundingClientRect` returns all-zero rects.
// These helpers are pure geometry over the DOM, so we build detached trees and
// stub each element's rect to simulate a laid-out editor.

type Rect = { top: number; bottom: number; left: number; right: number };

function setRect(el: Element, rect: Rect) {
  const full = {
    ...rect,
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...full, toJSON: () => full }) as DOMRect;
}

/** Creates a `[data-node-type]` element with an optional stubbed rect. */
function el(nodeType: string, rect?: Rect): HTMLElement {
  const node = document.createElement("div");
  node.setAttribute("data-node-type", nodeType);
  if (rect) {
    setRect(node, rect);
  }
  return node;
}

/** Wraps a block content node in the `blockOuter > blockContainer` chrome that
 * BlockNote renders around every regular block, returning the outer wrapper. */
function regularChild(rect?: Rect): {
  outer: HTMLElement;
  blockContainer: HTMLElement;
} {
  const outer = el("blockOuter");
  const blockContainer = el("blockContainer", rect);
  outer.append(blockContainer);
  return { outer, blockContainer };
}

function uiInfo(containerTypes: string[]): ContainerUIInfo {
  const set = new Set(containerTypes);
  return {
    containerTypes: set,
    draggableContainerTypes: set,
    containerSelector: containerTypes.length
      ? containerTypes.map((t) => `[data-node-type="${t}"]`).join(",")
      : null,
  };
}

/**
 * Builds a columnList with two columns laid out side-by-side, each holding a
 * single regular block. Returns the pieces so tests can probe them.
 */
function buildColumnList() {
  const info = uiInfo(["columnList", "column"]);

  const columnList = el("columnList", {
    top: 0,
    bottom: 100,
    left: 0,
    right: 200,
  });
  const columnA = el("column", { top: 0, bottom: 100, left: 0, right: 100 });
  const columnB = el("column", { top: 0, bottom: 100, left: 100, right: 200 });

  const childA = regularChild({ top: 0, bottom: 40, left: 0, right: 100 });
  const childB = regularChild({ top: 0, bottom: 40, left: 100, right: 200 });
  columnA.append(childA.outer);
  columnB.append(childB.outer);
  columnList.append(columnA, columnB);

  return { info, columnList, columnA, columnB, childA, childB };
}

/**
 * Builds a vertical container (callout-like) holding two stacked regular
 * blocks.
 */
function buildVerticalContainer() {
  const info = uiInfo(["callout"]);

  const callout = el("callout", { top: 0, bottom: 80, left: 0, right: 200 });
  const first = regularChild({ top: 0, bottom: 40, left: 0, right: 200 });
  const second = regularChild({ top: 40, bottom: 80, left: 0, right: 200 });
  callout.append(first.outer, second.outer);

  return { info, callout, first, second };
}

describe("getDirectChildBlocks", () => {
  it("returns direct child blocks, skipping nested grandchildren", () => {
    const { info, columnList, columnA, columnB } = buildColumnList();

    const children = getDirectChildBlocks(columnList, info);

    expect(children).toEqual([columnA, columnB]);
  });

  it("sees through blockOuter wrappers to the blockContainer child", () => {
    const { info, columnA, childA } = buildColumnList();

    // The column's own direct child is the wrapped blockContainer, not the
    // blockOuter chrome.
    expect(getDirectChildBlocks(columnA, info)).toEqual([
      childA.blockContainer,
    ]);
  });

  it("returns nothing for a container with no block children", () => {
    const info = uiInfo(["callout"]);
    const empty = el("callout");

    expect(getDirectChildBlocks(empty, info)).toEqual([]);
  });
});

describe("isHorizontalContainer", () => {
  it("is true when direct children overlap vertically (side-by-side)", () => {
    const { info, columnList } = buildColumnList();

    expect(isHorizontalContainer(columnList, info)).toBe(true);
  });

  it("is false when direct children are stacked", () => {
    const { info, callout } = buildVerticalContainer();

    expect(isHorizontalContainer(callout, info)).toBe(false);
  });

  it("is false for a single child", () => {
    const { info, columnA } = buildColumnList();

    expect(isHorizontalContainer(columnA, info)).toBe(false);
  });

  it("treats abutting (non-overlapping) children as vertical", () => {
    // Second child's top exactly meets the first child's bottom — a stack
    // with no gap must not be misread as horizontal.
    const info = uiInfo(["callout"]);
    const callout = el("callout");
    const a = regularChild({ top: 0, bottom: 40, left: 0, right: 200 });
    const b = regularChild({ top: 40, bottom: 80, left: 0, right: 200 });
    callout.append(a.outer, b.outer);

    expect(isHorizontalContainer(callout, info)).toBe(false);
  });
});

describe("hasHorizontalContainerAncestor", () => {
  it("is true for a block nested inside a column of a columnList", () => {
    const { info, childA } = buildColumnList();

    // The block sits inside a (vertical) column, whose parent columnList is
    // the horizontal one — the walk must climb past the column.
    expect(hasHorizontalContainerAncestor(childA.blockContainer, info)).toBe(
      true,
    );
  });

  it("is false for a block inside a purely vertical container", () => {
    const { info, first } = buildVerticalContainer();

    expect(hasHorizontalContainerAncestor(first.blockContainer, info)).toBe(
      false,
    );
  });

  it("is false when there is no container ancestor", () => {
    const info = uiInfo(["columnList", "column"]);
    const loose = regularChild();

    expect(hasHorizontalContainerAncestor(loose.blockContainer, info)).toBe(
      false,
    );
  });

  it("is false when the schema declares no containers", () => {
    const { childA } = buildColumnList();
    const info = uiInfo([]);

    expect(hasHorizontalContainerAncestor(childA.blockContainer, info)).toBe(
      false,
    );
  });
});

describe("getContainerChildAtCursor", () => {
  it("returns undefined for a non-container element", () => {
    const { info, childA } = buildColumnList();

    expect(
      getContainerChildAtCursor(childA.blockContainer, { x: 10, y: 10 }, info),
    ).toBeUndefined();
  });

  it("returns the child whose x range contains the cursor (horizontal)", () => {
    const { info, columnList, columnB } = buildColumnList();

    // x=150 lands in the second column's horizontal range.
    expect(getContainerChildAtCursor(columnList, { x: 150, y: 50 }, info)).toBe(
      columnB,
    );
  });

  it("prefers the x match over the first vertical match", () => {
    const { info, columnList, columnA } = buildColumnList();

    // x=10 is within column A; both columns share the y range.
    expect(getContainerChildAtCursor(columnList, { x: 10, y: 50 }, info)).toBe(
      columnA,
    );
  });

  it("falls back to the first vertical match when x is in the gutter", () => {
    const { info, callout, first } = buildVerticalContainer();

    // A vertical container: the cursor y is in the first child's band but x
    // is left of it (the side-menu gutter). The first vertical match wins.
    expect(getContainerChildAtCursor(callout, { x: -20, y: 20 }, info)).toBe(
      first.blockContainer,
    );
  });

  it("returns undefined when the cursor is below all children", () => {
    const { info, callout } = buildVerticalContainer();

    expect(
      getContainerChildAtCursor(callout, { x: 10, y: 999 }, info),
    ).toBeUndefined();
  });
});
