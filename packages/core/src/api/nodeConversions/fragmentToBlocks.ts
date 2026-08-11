import { Fragment, Node } from "@tiptap/pm/model";
import {
  BlockNoDefaults,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
  getChildBlocksConfig,
} from "../../schema/index.js";
import { isContainerNode } from "../blockManipulation/containers/fixContainer.js";
import { getBlockSchema } from "../pmUtil.js";
import { nodeToBlock } from "./nodeToBlock.js";

/**
 * Converts all Blocks within a fragment to BlockNote blocks.
 */
export function fragmentToBlocks<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(fragment: Fragment) {
  // first convert selection to blocknote-style blocks, and then
  // pass these to the exporter
  const blocks: BlockNoDefaults<B, I, S>[] = [];

  // Pushes a bnBlock node as a block, flattening containers that shouldn't
  // surface on their own: containers with fewer children than their `min`
  // (e.g. a single selected column of a columnList — the user selected
  // content within the container, not the container itself) and containers
  // that can't stand outside their parent (`topLevel: false`, e.g. a
  // `column`).
  const pushFlattened = (node: Node, root: Node) => {
    const config = getChildBlocksConfig(
      getBlockSchema(node.type.schema)[node.type.name] ?? {},
    );
    const belowMin =
      isContainerNode(node.type) &&
      config !== undefined &&
      node.childCount < (config.min ?? 1);
    const nonInsertable =
      isContainerNode(node.type) && !node.type.isInGroup("blockGroupChild");

    if (belowMin || nonInsertable) {
      node.forEach((child) => pushFlattened(child, root));
      return;
    }

    blocks.push(nodeToBlock(node, root));
  };

  fragment.descendants((node) => {
    if (node.type.name === "blockContainer") {
      if (node.firstChild?.type.name === "blockGroup") {
        // selection started within a block group
        // in this case the fragment starts with:
        // <blockContainer>
        //   <blockGroup>
        //     <blockContainer ... />
        //     <blockContainer ... />
        //   </blockGroup>
        // </blockContainer>
        //
        // instead of:
        // <blockContainer>
        //   <blockContent ... />
        //   <blockGroup>
        //     <blockContainer ... />
        //     <blockContainer ... />
        //   </blockGroup>
        // </blockContainer>
        //
        // so we don't need to serialize this block, just descend into the children of the blockGroup
        return true;
      }
    }

    if (node.type.isInGroup("bnBlock")) {
      pushFlattened(node, node);
      // don't descend into children, as they're already included in the block returned by nodeToBlock
      return false;
    }
    return true;
  });
  return blocks;
}
