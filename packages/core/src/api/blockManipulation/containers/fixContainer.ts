import { Fragment, Slice, type Node, type NodeType } from "prosemirror-model";
import { type Transaction } from "prosemirror-state";
import { ReplaceAroundStep } from "prosemirror-transform";
import type { Schema } from "prosemirror-model";

import {
  getChildBlocksConfig,
  getMinChildren,
} from "../../../schema/blocks/childBlocks.js";
import { getNodeById } from "../../nodeUtil.js";
import { getBlockSchema, getPmSchema } from "../../pmUtil.js";

export function isContainerNode(type: NodeType): boolean {
  return type.isInGroup("childContainer") && type.name !== "blockGroup";
}

/**
 * A container child is "empty" when it contributes no meaningful content:
 * a blockContainer with just an empty paragraph, or a nested container
 * whose only child is itself empty (recursively).
 *
 * Multi-child nodes are never empty — collapsing user-built structure would
 * be destructive.
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

function isInsertableChild(node: Node): boolean {
  return (
    node.type.name === "blockContainer" ||
    node.type.isInGroup("blockGroupChild")
  );
}

/**
 * Repairs a container after children were removed, per `collapseWhenEmptied`:
 * drops empty children, then unwraps the container if fewer than `min`
 * non-empty children remain.
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
    return;
  }

  const min = getMinChildren(config);

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
    tr.delete(containerPos, containerPos + refreshed.nodeSize);
    return;
  }

  // Unwrap: replace the container with its remaining non-empty children.
  if (nonEmptyChildren.length === 1) {
    const { child, offset } = nonEmptyChildren[0];
    const childStart = containerPos + 1 + offset;

    const [gapFrom, gapTo] = isInsertableChild(child)
      ? [childStart, childStart + child.nodeSize]
      : [childStart + 1, childStart + child.nodeSize - 1];

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

  // Several survivors but still below `min`: rebuild replacement content.
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
 * Runs `fixContainer` on containers by id, deepest first.
 * Re-locates each container before repair since positions shift.
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
 * Flattens blocks that can't be inserted at the top level (e.g. `column`)
 * into their children, recursively.
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
