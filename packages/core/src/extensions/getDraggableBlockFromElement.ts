import { EditorView } from "prosemirror-view";

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Walks up from `element` to the closest element that can host a side-menu
 * drag handle: a regular block (`blockContainer`) or a container block whose
 * type is in `draggableContainerTypes` (derived from each spec's
 * `meta.draggable`).
 */
export function getDraggableBlockFromElement(
  element: Element,
  view: EditorView,
  draggableContainerTypes: ReadonlySet<string> = EMPTY_SET,
) {
  const isDraggable = (el: Element) => {
    const nodeType = el.getAttribute?.("data-node-type");
    return (
      nodeType === "blockContainer" ||
      (nodeType !== null &&
        nodeType !== undefined &&
        draggableContainerTypes.has(nodeType))
    );
  };

  while (
    element &&
    element.parentElement &&
    element.parentElement !== view.dom &&
    !isDraggable(element)
  ) {
    element = element.parentElement;
  }
  if (!isDraggable(element)) {
    return undefined;
  }
  return { node: element as HTMLElement, id: element.getAttribute("data-id")! };
}
