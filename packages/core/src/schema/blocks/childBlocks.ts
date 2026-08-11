import type { ChildBlocksConfig } from "./types.js";

export const CHILD_CONTAINER_GROUP = "childContainer";

export const BLOCK_GROUP_CHILD_GROUP = "blockGroupChild";

// Below `blockContainer`'s priority (50): PM's `fillBefore` picks the first
// matching type in a group, and `blockContainer` must win so auto-fill doesn't
// recurse through nested containers.
export const CONTAINER_NODE_PRIORITY = 40;

// Shared frozen instance so `childBlocks: true` configs always compare equal.
const EMPTY_CHILD_BLOCKS_CONFIG: ChildBlocksConfig = Object.freeze({});

// Normalizes the `childBlocks: true` shorthand at read time. Downstream code
// must use this instead of reading `config.childBlocks` directly — the user's
// config object is never mutated, so `blockSchema[type]` identity checks
// (e.g. `checkMultiColumnBlocksInSchema`) stay valid across schema instances.
export function getChildBlocksConfig(config: {
  childBlocks?: true | ChildBlocksConfig;
}): ChildBlocksConfig | undefined {
  if (!config.childBlocks) {
    return undefined;
  }
  return config.childBlocks === true
    ? EMPTY_CHILD_BLOCKS_CONFIG
    : config.childBlocks;
}

export function isContainerType(config: {
  childBlocks?: true | ChildBlocksConfig;
}): boolean {
  return getChildBlocksConfig(config) !== undefined;
}

export function getMinChildren(childBlocks: ChildBlocksConfig): number {
  return childBlocks.min ?? 1;
}

export function isTopLevelContainer(childBlocks: ChildBlocksConfig): boolean {
  return childBlocks.topLevel !== false;
}

// Builds the ProseMirror content expression for a container block from its
// `childBlocks` config.
//
// `allowedBlocks` entries are BlockNote block types, but container children
// are PM *nodes*: container-type blocks are their own node type, while every
// regular block lives inside a `blockContainer` node. So container entries
// are kept verbatim and regular entries collapse to a single `blockContainer`
// term. `blockContainer` is deliberately ordered FIRST in the union — PM's
// `fillBefore` picks the first matching type when auto-filling a non-optional
// node, and filling with `blockContainer` (rather than another container)
// keeps auto-fill from recursing through nested containers.
export function childBlocksContentExpression(
  childBlocks: ChildBlocksConfig,
  isContainerBlockType: (blockType: string) => boolean,
): string {
  const min = getMinChildren(childBlocks);
  const { max, allowedBlocks } = childBlocks;

  let term: string;
  if (!allowedBlocks) {
    term = BLOCK_GROUP_CHILD_GROUP;
  } else {
    const terms: string[] = [];
    if (allowedBlocks.some((blockType) => !isContainerBlockType(blockType))) {
      terms.push("blockContainer");
    }
    terms.push(...allowedBlocks.filter(isContainerBlockType));

    if (terms.length === 0) {
      throw new Error(
        "`childBlocks.allowedBlocks` must not be empty. Omit it to allow any block.",
      );
    }

    term = terms.length === 1 ? terms[0] : `(${terms.join(" | ")})`;
  }

  return `${term}${childCountQuantifier(min, max)}`;
}

function childCountQuantifier(min: number, max: number | undefined): string {
  if (max === undefined) {
    if (min === 0) {
      return "*";
    }
    if (min === 1) {
      return "+";
    }
    return `{${min},}`;
  }
  return `{${min},${max}}`;
}
