import { describe, expect, it } from "vite-plus/test";

import { validateChildBlocksConfigs } from "./validateChildBlocks.js";

const paragraph = { config: { type: "paragraph", content: "inline" } } as any;

function specsWith(containers: Record<string, any>) {
  return {
    paragraph,
    ...Object.fromEntries(
      Object.entries(containers).map(([type, { childBlocks, meta }]) => [
        type,
        {
          config: { type, content: "none", childBlocks },
          implementation: meta ? { meta } : {},
        },
      ]),
    ),
  };
}

function isContainerType(specs: Record<string, any>) {
  return (type: string) => specs[type]?.config?.childBlocks !== undefined;
}

describe("validateChildBlocksConfigs", () => {
  it("accepts a plain container config", () => {
    const specs = specsWith({ callout: { childBlocks: { min: 1 } } });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).not.toThrow();
  });

  it("accepts the columnList shape (restricted children, min 2)", () => {
    const specs = specsWith({
      grid: { childBlocks: { allowedBlocks: ["gridCell"], min: 2 } },
      gridCell: { childBlocks: { topLevel: false } },
    });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).not.toThrow();
  });

  it("rejects unknown allowedBlocks entries", () => {
    const specs = specsWith({
      grid: { childBlocks: { allowedBlocks: ["doesNotExist"] } },
    });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).toThrow(/doesNotExist/);
  });

  it("rejects negative or non-integer min", () => {
    const specs = specsWith({ callout: { childBlocks: { min: -1 } } });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).toThrow(/min/);
  });

  it("rejects max smaller than min", () => {
    const specs = specsWith({ callout: { childBlocks: { min: 3, max: 2 } } });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).toThrow(/max/);
  });

  it("rejects defaultChildren violating min/max", () => {
    const specs = specsWith({
      callout: {
        childBlocks: {
          min: 2,
          defaultChildren: [{ type: "paragraph" }],
        },
      },
    });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).toThrow(/defaultChildren/);
  });

  it("rejects defaultChildren of unknown types", () => {
    const specs = specsWith({
      callout: {
        childBlocks: { defaultChildren: [{ type: "doesNotExist" }] },
      },
    });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).toThrow(/doesNotExist/);
  });

  it("rejects defaultChildren not allowed by allowedBlocks", () => {
    const specs = specsWith({
      grid: {
        childBlocks: {
          allowedBlocks: ["gridCell"],
          min: 1,
          defaultChildren: [{ type: "paragraph" }],
        },
      },
      gridCell: { childBlocks: { topLevel: false } },
    });
    expect(() =>
      validateChildBlocksConfigs(specs, isContainerType(specs)),
    ).toThrow(/not allowed/);
  });
});
