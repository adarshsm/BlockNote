import { Fragment, Node } from "@tiptap/pm/model";
import {
  BlockNoDefaults,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "../../schema/index.js";
import {
  getChildBlocksConfig,
  getMinChildren,
  isTopLevelContainer,
} from "../../schema/blocks/childBlocks.js";
import { isContainerNode } from "../blockManipulation/containers/fixContainer.js";
import { getBlockSchema } from "../pmUtil.js";
import { nodeToBlock } from "./nodeToBlock.js";

/**
 * Whether a container node is "self-contained" — it has enough children to
 * stand on its own and is allowed at the top level. Containers that aren't
 * (e.g. a single selected column of a columnList) are flattened into their
 * children.
 */
function isSelfContainedContainer(node: Node): boolean {
  if (!isContainerNode(node.type)) {
    return false;
  }
  const childBlocks = getChildBlocksConfig(
    getBlockSchema(node.type.schema)[node.type.name] ?? {},
  );
  if (!childBlocks) {
    return false;
  }
  return (
    isTopLevelContainer(childBlocks) &&
    node.childCount >= getMinChildren(childBlocks)
  );
}

/**
 * Converts all Blocks within a fragment to BlockNote blocks.
 */
export function fragmentToBlocks<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(fragment: Fragment) {
  const blocks: BlockNoDefaults<B, I, S>[] = [];

  const pushFlattened = (node: Node, root: Node) => {
    if (isContainerNode(node.type) && !isSelfContainedContainer(node)) {
      node.forEach((child) => pushFlattened(child, root));
      return;
    }
    blocks.push(nodeToBlock(node, root));
  };

  fragment.descendants((node) => {
    if (node.type.name === "blockContainer") {
      if (node.firstChild?.type.name === "blockGroup") {
        // Selection started within a block group — the fragment wraps the
        // children in a blockContainer > blockGroup without a blockContent,
        // so we descend into the blockGroup's children instead.
        return true;
      }
    }

    if (node.type.isInGroup("bnBlock")) {
      pushFlattened(node, node);
      return false;
    }
    return true;
  });
  return blocks;
}
