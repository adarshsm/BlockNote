import { describe, expect, it } from "vite-plus/test";

import { validateChildBlocksConfigs } from "./validateChildBlocks.js";

function configsWith(containers: Record<string, any>) {
  return {
    paragraph: { type: "paragraph", content: "inline" as const },
    ...Object.fromEntries(
      Object.entries(containers).map(([type, { childBlocks }]) => [
        type,
        { type, content: "none" as const, childBlocks },
      ]),
    ),
  };
}

describe("validateChildBlocksConfigs", () => {
  it("accepts a plain container config", () => {
    const configs = configsWith({ callout: { childBlocks: { min: 1 } } });
    expect(() => validateChildBlocksConfigs(configs)).not.toThrow();
  });

  it("accepts the columnList shape (restricted children, min 2)", () => {
    const configs = configsWith({
      grid: { childBlocks: { allowedBlocks: ["gridCell"], min: 2 } },
      gridCell: { childBlocks: { topLevel: false } },
    });
    expect(() => validateChildBlocksConfigs(configs)).not.toThrow();
  });

  it("rejects unknown allowedBlocks entries", () => {
    const configs = configsWith({
      grid: { childBlocks: { allowedBlocks: ["doesNotExist"] } },
    });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(/doesNotExist/);
  });

  it("rejects negative or non-integer min", () => {
    const configs = configsWith({ callout: { childBlocks: { min: -1 } } });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(/min/);
  });

  it("rejects max smaller than min", () => {
    const configs = configsWith({
      callout: { childBlocks: { min: 3, max: 2 } },
    });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(/max/);
  });

  it("rejects defaultChildren violating min/max", () => {
    const configs = configsWith({
      callout: {
        childBlocks: {
          min: 2,
          defaultChildren: [{ type: "paragraph" }],
        },
      },
    });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(
      /defaultChildren/,
    );
  });

  it("rejects defaultChildren of unknown types", () => {
    const configs = configsWith({
      callout: {
        childBlocks: { defaultChildren: [{ type: "doesNotExist" }] },
      },
    });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(/doesNotExist/);
  });

  it("rejects defaultChildren not allowed by allowedBlocks", () => {
    const configs = configsWith({
      grid: {
        childBlocks: {
          allowedBlocks: ["gridCell"],
          min: 1,
          defaultChildren: [{ type: "paragraph" }],
        },
      },
      gridCell: { childBlocks: { topLevel: false } },
    });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(
      /not permitted by/,
    );
  });

  it("rejects content that is not 'none'", () => {
    const configs = {
      paragraph: { type: "paragraph", content: "inline" },
      bad: { type: "bad", content: "inline", childBlocks: true },
    };
    expect(() => validateChildBlocksConfigs(configs as any)).toThrow(
      /content: "none"/,
    );
  });

  it("rejects empty allowedBlocks", () => {
    const configs = configsWith({
      callout: { childBlocks: { allowedBlocks: [] } },
    });
    expect(() => validateChildBlocksConfigs(configs)).toThrow(
      /must not be empty/,
    );
  });
});
