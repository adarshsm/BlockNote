import { getChildBlocksConfig } from "./internal.js";
import { BlockConfig } from "./types.js";

type SpecLike = {
  config: BlockConfig;
};

/**
 * Validates every `childBlocks` config in a spec set when a schema is
 * created, so misconfigurations fail with a clear message at build time
 * instead of surfacing as opaque ProseMirror errors deep inside schema
 * compilation or document mutations. Kept to the cheap correctness guards
 * only — it does not try to robustly detect fill cycles (a custom-schema dev
 * foot-gun, out of scope).
 */
export function validateChildBlocksConfigs(
  blockSpecs: Record<string, SpecLike>,
  isContainerType: (type: string) => boolean,
): void {
  for (const [type, spec] of Object.entries(blockSpecs)) {
    const config = getChildBlocksConfig(spec.config);

    if (!config) {
      continue;
    }

    const min = config.min ?? 1;
    const max = config.max ?? Infinity;

    if (!Number.isInteger(min) || min < 0) {
      throw new Error(
        `Block "${type}": \`childBlocks.min\` must be a non-negative integer, got ${config.min}.`,
      );
    }
    if (config.max !== undefined && (!Number.isInteger(max) || max < 1)) {
      throw new Error(
        `Block "${type}": \`childBlocks.max\` must be a positive integer, got ${config.max}.`,
      );
    }
    if (max < min) {
      throw new Error(
        `Block "${type}": \`childBlocks.max\` (${max}) is smaller than \`min\` (${min}).`,
      );
    }

    for (const allowed of config.allowedBlocks ?? []) {
      if (!(allowed in blockSpecs)) {
        throw new Error(
          `Block "${type}": \`childBlocks.allowedBlocks\` entry "${allowed}" does not exist in the schema.`,
        );
      }
    }

    if (config.defaultChildren) {
      if (
        config.defaultChildren.length < min ||
        config.defaultChildren.length > max
      ) {
        throw new Error(
          `Block "${type}": \`childBlocks.defaultChildren\` has ${config.defaultChildren.length} entries, which does not satisfy min ${min}` +
            (config.max !== undefined ? ` / max ${max}` : "") +
            `.`,
        );
      }
      for (const child of config.defaultChildren) {
        const childType = child.type ?? "paragraph";
        if (!(childType in blockSpecs)) {
          throw new Error(
            `Block "${type}": \`childBlocks.defaultChildren\` entry type "${childType}" does not exist in the schema.`,
          );
        }
        if (config.allowedBlocks && config.allowedBlocks.length > 0) {
          // Mirror the node-level enforcement: container types must be listed
          // explicitly; regular types pass if any regular type is allowed.
          const allowedContainerTypes = config.allowedBlocks.filter((t) =>
            isContainerType(t),
          );
          const allowsRegularTypes =
            allowedContainerTypes.length < config.allowedBlocks.length;
          const isAllowed = isContainerType(childType)
            ? config.allowedBlocks.includes(childType)
            : allowsRegularTypes;
          if (!isAllowed) {
            throw new Error(
              `Block "${type}": \`childBlocks.defaultChildren\` entry type "${childType}" is not allowed by \`allowedBlocks\` [${config.allowedBlocks.join(", ")}].`,
            );
          }
        }
      }
    }
  }
}
