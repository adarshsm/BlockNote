import {
  getChildBlocksConfig,
  getMinChildren,
  isContainerType,
} from "./childBlocks.js";
import type { BlockConfig, ChildBlocksConfig } from "./types.js";

/**
 * Validates the `childBlocks` config of every block in a schema, so that
 * misconfigurations surface as a clear error at schema-creation time instead of
 * as an opaque ProseMirror one (or a stack overflow) much later.
 *
 * @param blockConfigs The configs of every block in the schema, keyed by type.
 */
export function validateChildBlocksConfigs(
  blockConfigs: Record<
    string,
    Pick<BlockConfig, "type" | "content"> & {
      childBlocks?: true | ChildBlocksConfig;
    }
  >,
) {
  const isContainerBlockType = (blockType: string) =>
    !!blockConfigs[blockType] && isContainerType(blockConfigs[blockType]);

  for (const [type, config] of Object.entries(blockConfigs)) {
    const childBlocks = getChildBlocksConfig(config);
    if (!childBlocks) {
      continue;
    }

    validateOne(
      type,
      config.content,
      childBlocks,
      blockConfigs,
      isContainerBlockType,
    );
  }
}

function validateOne(
  type: string,
  content: string,
  childBlocks: ChildBlocksConfig,
  blockConfigs: Record<string, unknown>,
  isContainerBlockType: (blockType: string) => boolean,
) {
  const fail = (message: string): never => {
    throw new Error(
      `Invalid \`childBlocks\` config for block "${type}": ${message}`,
    );
  };

  if (content !== "none") {
    fail(
      `\`childBlocks\` requires \`content: "none"\`, but content is "${content}". A container block holds blocks, not inline content.`,
    );
  }

  const min = getMinChildren(childBlocks);
  const { max, allowedBlocks, defaultChildren } = childBlocks;

  if (!Number.isInteger(min) || min < 0) {
    fail(`\`min\` must be a non-negative integer, but is ${min}.`);
  }

  if (max !== undefined) {
    if (!Number.isInteger(max) || max < 1) {
      fail(`\`max\` must be a positive integer, but is ${max}.`);
    }
    if (max < min) {
      fail(
        `\`max\` (${max}) must be greater than or equal to \`min\` (${min}).`,
      );
    }
  }

  if (allowedBlocks) {
    if (allowedBlocks.length === 0) {
      fail("`allowedBlocks` must not be empty. Omit it to allow any block.");
    }
    for (const allowed of allowedBlocks) {
      if (!(allowed in blockConfigs)) {
        fail(
          `\`allowedBlocks\` contains "${allowed}", which is not a block type in this schema.`,
        );
      }
    }
  }

  if (defaultChildren) {
    if (defaultChildren.length < min) {
      fail(
        `\`defaultChildren\` has ${defaultChildren.length} block(s), fewer than \`min\` (${min}).`,
      );
    }
    if (max !== undefined && defaultChildren.length > max) {
      fail(
        `\`defaultChildren\` has ${defaultChildren.length} block(s), more than \`max\` (${max}).`,
      );
    }
    for (const child of defaultChildren) {
      const childType = child.type ?? "paragraph";
      if (!(childType in blockConfigs)) {
        fail(
          `\`defaultChildren\` contains a block of type "${childType}", which is not a block type in this schema.`,
        );
      }
      if (
        allowedBlocks &&
        !isAllowed(childType, allowedBlocks, isContainerBlockType)
      ) {
        fail(
          `\`defaultChildren\` contains a block of type "${childType}", which is not permitted by \`allowedBlocks\`.`,
        );
      }
    }
  }
}

function isAllowed(
  blockType: string,
  allowedBlocks: string[],
  isContainerBlockType: (blockType: string) => boolean,
): boolean {
  if (allowedBlocks.includes(blockType)) {
    return true;
  }
  return (
    !isContainerBlockType(blockType) &&
    allowedBlocks.some((allowed) => !isContainerBlockType(allowed))
  );
}
