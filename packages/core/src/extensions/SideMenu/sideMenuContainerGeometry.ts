import type { ContainerUIInfo } from "../../api/blockManipulation/containers/containerUI.js";

/**
 * DOM hit-testing helpers the side menu uses to resolve which block a cursor
 * is over inside container blocks. They read live layout geometry
 * (`getBoundingClientRect`) rather than any declared layout flag, so container
 * blocks don't have to describe their own layout — a container whose children
 * happen to sit side-by-side (like a column list) is detected as such.
 */

/**
 * The selector matching any block that can be a direct child of a container:
 * a regular block (`blockContainer`) or a nested container element.
 */
function containerChildSelector(containerUIInfo: ContainerUIInfo): string {
  return containerUIInfo.containerSelector
    ? `[data-node-type="blockContainer"],${containerUIInfo.containerSelector}`
    : `[data-node-type="blockContainer"]`;
}

/**
 * The direct child block elements of a container element (in the block
 * sense): the closest block element above each match must be the container
 * itself. Matches `blockContainer`s (regular children) and nested container
 * elements.
 */
export function getDirectChildBlocks(
  container: Element,
  containerUIInfo: ContainerUIInfo,
): Element[] {
  const childSelector = containerChildSelector(containerUIInfo);

  const children: Element[] = [];
  for (const child of container.querySelectorAll(childSelector)) {
    if (child.parentElement?.closest(childSelector) === container) {
      children.push(child);
    }
  }
  return children;
}

/**
 * Whether a container element lays its direct child blocks out side-by-side
 * (like a column list), detected from geometry rather than a declared flag:
 * two direct children that overlap along the vertical axis can only be
 * sitting next to each other horizontally.
 */
export function isHorizontalContainer(
  container: Element,
  containerUIInfo: ContainerUIInfo,
): boolean {
  const rects = getDirectChildBlocks(container, containerUIInfo).map((child) =>
    child.getBoundingClientRect(),
  );
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].top < rects[j].bottom && rects[j].top < rects[i].bottom) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether `element` sits inside a horizontal container at any depth (e.g. a
 * block inside a column of a columnList — the columnList, not the column, is
 * the horizontal one). Walks up the container ancestor chain.
 */
export function hasHorizontalContainerAncestor(
  element: Element,
  containerUIInfo: ContainerUIInfo,
): boolean {
  if (!containerUIInfo.containerSelector) {
    return false;
  }
  let container = element.closest(containerUIInfo.containerSelector);
  while (container) {
    if (isHorizontalContainer(container, containerUIInfo)) {
      return true;
    }
    container =
      container.parentElement?.closest(containerUIInfo.containerSelector) ??
      null;
  }
  return false;
}

/**
 * If `element` is a container block's element, finds its direct child block
 * whose vertical range contains the cursor. Hovering a container's own
 * chrome (padding, a title bar, the side-menu gutter) next to a child
 * should attach the side menu to that child — mirroring how hovering a
 * parent block's gutter next to a nested block attaches to the nested
 * block. The container's own menu stays reachable on rows occupied only by
 * its chrome. When children sit side-by-side, a child containing the
 * cursor's x position wins over the first vertical match.
 */
export function getContainerChildAtCursor(
  element: Element,
  mousePos: { x: number; y: number },
  containerUIInfo: ContainerUIInfo,
): Element | undefined {
  const nodeType = element.getAttribute("data-node-type");
  if (!nodeType || !containerUIInfo.containerTypes.has(nodeType)) {
    return undefined;
  }

  let verticalMatch: Element | undefined = undefined;
  for (const child of getDirectChildBlocks(element, containerUIInfo)) {
    const rect = child.getBoundingClientRect();
    if (mousePos.y < rect.top || mousePos.y > rect.bottom) {
      continue;
    }
    if (mousePos.x >= rect.left && mousePos.x <= rect.right) {
      return child;
    }
    verticalMatch = verticalMatch ?? child;
  }
  return verticalMatch;
}
