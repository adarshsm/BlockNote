import type { Node, NodeType } from "prosemirror-model";

import { isContainerNode } from "./fixContainer.js";

/**
 * Position-based helpers for navigating container blocks. These generalize
 * what the keyboard handlers used to hard-code for the exact
 * `columnList > column > blockContainer` shape: they recurse through
 * arbitrarily nested containers and consult the schema's content matches
 * instead of assuming two levels.
 */

/**
 * Finds the deepest position inside `container` where a node of `nodeType`
 * can be appended at the end, descending through trailing nested containers
 * (e.g. into the last `column` of a `columnList`, which itself doesn't accept
 * `blockContainer` children). Returns null if no level accepts the node.
 * @param container The container node.
 * @param containerBeforePos The position just before `container`.
 * @param nodeType The node type to find an insertion position for.
 */
export function descendToLastInsertionPos(
  container: Node,
  containerBeforePos: number,
  nodeType: NodeType,
): number | null {
  const endPos = containerBeforePos + 1 + container.content.size;
  if (container.contentMatchAt(container.childCount).matchType(nodeType)) {
    return endPos;
  }
  const lastChild = container.lastChild;
  if (lastChild && isContainerNode(lastChild.type)) {
    return descendToLastInsertionPos(
      lastChild,
      endPos - lastChild.nodeSize,
      nodeType,
    );
  }
  return null;
}

/**
 * Mirror of `descendToLastInsertionPos`: the deepest position inside
 * `container` where a node of `nodeType` can be prepended at the start.
 */
export function descendToFirstInsertionPos(
  container: Node,
  containerBeforePos: number,
  nodeType: NodeType,
): number | null {
  const startPos = containerBeforePos + 1;
  if (container.contentMatchAt(0).matchType(nodeType)) {
    return startPos;
  }
  const firstChild = container.firstChild;
  if (firstChild && isContainerNode(firstChild.type)) {
    return descendToFirstInsertionPos(firstChild, startPos, nodeType);
  }
  return null;
}

/**
 * Descends through leading nested containers to the first non-container child
 * (e.g. the first `blockContainer` inside the first `column` of a
 * `columnList`). Returns null for a container whose leading chain has no
 * such child.
 * @param container The container node.
 * @param containerBeforePos The position just before `container`.
 */
export function getFirstLeafBlock(
  container: Node,
  containerBeforePos: number,
): { node: Node; beforePos: number } | null {
  const firstChild = container.firstChild;
  if (!firstChild) {
    return null;
  }
  const firstChildBeforePos = containerBeforePos + 1;
  if (isContainerNode(firstChild.type)) {
    return getFirstLeafBlock(firstChild, firstChildBeforePos);
  }
  return { node: firstChild, beforePos: firstChildBeforePos };
}

/**
 * Climbs upward from a position until one is found where a node of
 * `nodeType` may be inserted, moving to just before each enclosing container
 * in turn (e.g. from before a first `column` — where only `column` nodes are
 * allowed — to before the enclosing `columnList`). Returns null when an
 * enclosing non-container parent still doesn't accept the node.
 * @param doc The document to resolve positions in.
 * @param pos The position to start climbing from.
 * @param nodeType The node type to find an insertion position for.
 */
export function ascendToInsertablePos(
  doc: Node,
  pos: number,
  nodeType: NodeType,
): number | null {
  for (;;) {
    const $pos = doc.resolve(pos);
    const parent = $pos.node();
    if (parent.contentMatchAt($pos.index()).matchType(nodeType)) {
      return pos;
    }
    if (isContainerNode(parent.type) && $pos.depth > 0) {
      pos = $pos.before();
      continue;
    }
    return null;
  }
}

/**
 * Collects the chain of container-node ancestors at a position (deepest
 * first) as `{ id, depth }` entries. Containers are re-located by id when
 * repairing, since repairs shift positions.
 * @param doc The document to resolve the position in.
 * @param pos A position inside the containers of interest.
 */
export function getAncestorContainers(
  doc: Node,
  pos: number,
): { id: string; depth: number }[] {
  const $pos = doc.resolve(pos);
  const containers: { id: string; depth: number }[] = [];
  for (let depth = $pos.depth; depth > 0; depth--) {
    const ancestor = $pos.node(depth);
    if (isContainerNode(ancestor.type) && ancestor.attrs.id) {
      containers.push({ id: ancestor.attrs.id, depth });
    }
  }
  return containers;
}
