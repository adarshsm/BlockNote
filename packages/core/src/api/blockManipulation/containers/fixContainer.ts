import { Fragment, Slice, type Node, type NodeType } from "prosemirror-model";
import { type Transaction } from "prosemirror-state";
import { ReplaceAroundStep } from "prosemirror-transform";
import type { Schema } from "prosemirror-model";

import { getChildBlocksConfig } from "../../../schema/blocks/internal.js";
import { getNodeById } from "../../nodeUtil.js";
import { getBlockSchema, getPmSchema } from "../../pmUtil.js";

/**
 * Whether a PM node type is a container block node — a `bnBlock` that holds
 * child blocks directly (e.g. `column`, `columnList`, or any block declaring
 * `childBlocks`). `blockGroup` shares the `childContainer` group (it's the
 * child-holding node of regular indentation) but is not a container block.
 */
export function isContainerNode(type: NodeType): boolean {
  return type.isInGroup("childContainer") && type.name !== "blockGroup";
}

/**
 * Checks whether a direct child of a container is "empty":
 * - a `blockContainer` holding a single empty paragraph and nothing else;
 * - a nested container whose single child is itself empty.
 *
 * (A child holding several blocks is never considered empty, even if each of
 * them is — collapsing multi-block structure the user built up would be
 * destructive.)
 */
export function isEmptyContainerChild(node: Node): boolean {
  if (node.type.name === "blockContainer") {
    const blockContent = node.firstChild;
    return (
      node.childCount === 1 &&
      !!blockContent &&
      blockContent.type.name === "paragraph" &&
      blockContent.childCount === 0
    );
  }
  if (isContainerNode(node.type)) {
    return node.childCount === 1 && isEmptyContainerChild(node.firstChild!);
  }
  return false;
}

/**
 * Removes all empty children (see `isEmptyContainerChild`) of the container
 * node at `containerPos`. If the removals leave the container below its
 * schema minimum, ProseMirror re-adds empty children to fit the schema —
 * `fixContainer` detects that state via the non-empty child count.
 * @param tr The `Transaction` to add the changes to.
 * @param containerPos The position just before the container node.
 */
export function removeEmptyChildren(tr: Transaction, containerPos: number) {
  const container = tr.doc.resolve(containerPos).nodeAfter;
  if (!container || !isContainerNode(container.type)) {
    throw new Error(
      "Invalid containerPos: does not point to a container node.",
    );
  }

  for (
    let childIndex = container.childCount - 1;
    childIndex >= 0;
    childIndex--
  ) {
    const childPos = tr.doc.resolve(containerPos + 1).posAtIndex(childIndex);
    const child = tr.doc.resolve(childPos).nodeAfter;
    if (!child) {
      throw new Error("Invalid childPos: does not point to a child node.");
    }

    if (isEmptyContainerChild(child)) {
      tr.delete(childPos, childPos + child.nodeSize);
    }
  }
}

// A container child is directly insertable next to the container itself when
// its node can sit anywhere a regular block goes. Children that can't
// (`topLevel: false` containers, like `column`) are flattened into *their*
// children when a container is unwrapped.
function isInsertableChild(node: Node): boolean {
  return (
    node.type.name === "blockContainer" ||
    node.type.isInGroup("blockGroupChild")
  );
}

/**
 * Repairs the container node at `containerPos` after children were (re)moved
 * from it, according to the block's `childBlocks.collapseWhenEmptied` config:
 *
 * - When `collapseWhenEmptied` is set, drops empty children. If that leaves
 *   fewer than `min` non-empty children (ProseMirror pads the container back
 *   up to `min` with empty ones, so the *total* count never drops), unwraps
 *   the container — replacing it with its remaining non-empty children
 *   (non-top-level container children are flattened into their own children),
 *   or deleting it when none remain.
 * - Containers without `collapseWhenEmptied` are left untouched: ProseMirror's
 *   schema fitting already guarantees they satisfy `min`.
 *
 * This generalizes what `fixColumnList` did for column lists.
 * @param tr The `Transaction` to add the changes to.
 * @param containerPos The position just before the container node.
 */
export function fixContainer(tr: Transaction, containerPos: number) {
  const container = tr.doc.resolve(containerPos).nodeAfter;
  if (!container || !isContainerNode(container.type)) {
    throw new Error(
      "Invalid containerPos: does not point to a container node.",
    );
  }

  const blockConfig = getBlockSchema(getPmSchema(tr))[container.type.name];
  const config = blockConfig ? getChildBlocksConfig(blockConfig) : undefined;

  if (!config?.collapseWhenEmptied) {
    return;
  }

  removeEmptyChildren(tr, containerPos);

  const refreshed = tr.doc.resolve(containerPos).nodeAfter;
  if (!refreshed || refreshed.type !== container.type) {
    // The container itself disappeared as a side effect of the deletions
    // (shouldn't happen, but there is nothing left to repair).
    return;
  }

  const min = config.min ?? 1;

  const nonEmptyChildren: { child: Node; offset: number }[] = [];
  refreshed.forEach((child, offset) => {
    if (!isEmptyContainerChild(child)) {
      nonEmptyChildren.push({ child, offset });
    }
  });

  if (nonEmptyChildren.length >= min) {
    return;
  }

  if (nonEmptyChildren.length === 0) {
    // Nothing worth keeping — remove the container entirely.
    tr.delete(containerPos, containerPos + refreshed.nodeSize);
    return;
  }

  // Unwrap: replace the container with its remaining non-empty children.
  if (nonEmptyChildren.length === 1) {
    // Single survivor: move its content out with a `ReplaceAroundStep` so the
    // content is mapped (moved) rather than deleted-and-recreated — this
    // keeps cursor positions and collaborative rebasing stable.
    const { child, offset } = nonEmptyChildren[0];
    const childStart = containerPos + 1 + offset;

    const [gapFrom, gapTo] = isInsertableChild(child)
      ? // The child node itself can go where the container was.
        [childStart, childStart + child.nodeSize]
      : // The child (e.g. a `column`) can't — its *content* can.
        [childStart + 1, childStart + child.nodeSize - 1];

    tr.step(
      new ReplaceAroundStep(
        containerPos,
        containerPos + refreshed.nodeSize,
        gapFrom,
        gapTo,
        Slice.empty,
        0,
        false,
      ),
    );
    return;
  }

  // Several survivors but still below `min` (only possible when `min` > 2):
  // no single gap covers them, so rebuild the replacement content.
  const replacement: Node[] = [];
  for (const { child } of nonEmptyChildren) {
    if (isInsertableChild(child)) {
      replacement.push(child);
    } else {
      child.forEach((grandChild) => replacement.push(grandChild));
    }
  }
  tr.replaceWith(
    containerPos,
    containerPos + refreshed.nodeSize,
    Fragment.from(replacement),
  );
}

/**
 * Runs `fixContainer` on a set of containers identified by id, deepest
 * first. Containers are re-located by id before each repair, since a repair
 * (or the caller's preceding mutations) shifts positions — a container that
 * an earlier repair removed is skipped.
 * @param tr The `Transaction` to add the changes to.
 * @param containers The containers to repair, with the depth they were
 * originally found at (used only for ordering).
 */
export function fixContainersById(
  tr: Transaction,
  containers: { id: string; depth: number }[],
) {
  [...containers]
    .sort((a, b) => b.depth - a.depth)
    .forEach(({ id }) => {
      const target = getNodeById(id, tr.doc);
      if (!target) {
        return;
      }
      fixContainer(tr, target.posBeforeNode);
    });
}

/**
 * Replaces blocks that cannot be inserted at the top level of a document
 * region (containers with `childBlocks.topLevel: false`, like `column`) with
 * their children, recursively. Used when moving/copying blocks out of a
 * container into a regular block position.
 */
export function flattenNonInsertableBlocks<
  T extends { type?: string; children?: T[] },
>(blocks: T[], pmSchema: Schema): T[] {
  return blocks.flatMap((block) => {
    const nodeType = block.type ? pmSchema.nodes[block.type] : undefined;
    if (
      nodeType &&
      nodeType.isInGroup("bnBlock") &&
      !nodeType.isInGroup("blockGroupChild")
    ) {
      return flattenNonInsertableBlocks(block.children ?? [], pmSchema);
    }
    return [block];
  });
}
