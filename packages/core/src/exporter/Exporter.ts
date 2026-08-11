import { BlockNoteSchema } from "../blocks/BlockNoteSchema.js";
import { COLORS_DEFAULT } from "../editor/defaultColors.js";
import {
  BlockFromConfig,
  BlockSchema,
  InlineContent,
  InlineContentSchema,
  StyleSchema,
  StyledText,
  Styles,
} from "../schema/index.js";
import { isContainerType } from "../schema/blocks/childBlocks.js";

import type {
  BlockMapping,
  InlineContentMapping,
  StyleMapping,
} from "./mapping.js";

export type ExporterOptions = {
  /**
   * A function that can be used to resolve files, images, etc.
   * Exporters might need the binary contents of files like images,
   * which might not always be available from the same origin as the main page.
   * You can use this option to proxy requests through a server you control
   * to avoid cross-origin (CORS) issues.
   *
   * @default uses a BlockNote hosted proxy (https://corsproxy.api.blocknotejs.org/)
   * @param url - The URL of the file to resolve
   * @returns A Promise that resolves to a string (the URL to use instead of the original)
   * or a Blob (you can return the Blob directly if you have already fetched it)
   */
  resolveFileUrl?: (url: string) => Promise<string | Blob>;
  /**
   * Colors to use for background of blocks, font colors, and highlight colors
   */
  colors: typeof COLORS_DEFAULT;
};
export abstract class Exporter<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
  RB,
  RI,
  RS,
  TS,
> {
  // Stored with erased generics: a generically-typed property would change
  // the class's variance in B/I/S and break mapping inference at subclass
  // construction sites (the schema param was previously inference-only).
  private readonly blockNoteSchema: BlockNoteSchema<any, any, any>;

  public constructor(
    schema: BlockNoteSchema<B, I, S>,
    protected readonly mappings: {
      blockMapping: BlockMapping<B, I, S, RB, RI>;
      inlineContentMapping: InlineContentMapping<I, S, RI, TS>;
      styleMapping: StyleMapping<S, RS>;
    },
    public readonly options: ExporterOptions,
  ) {
    this.blockNoteSchema = schema;
  }

  /**
   * Whether a block type is a container block (declares `childBlocks`, e.g.
   * `columnList`, `column`, or a custom callout). Container mappings own the
   * placement of their children — exporters must not append the children
   * after the container's own output.
   */
  public isContainerBlock(blockType: string): boolean {
    const spec = (this.blockNoteSchema.blockSpecs as Record<string, any>)[
      blockType
    ];
    return !!spec && isContainerType(spec.config);
  }

  public async resolveFile(url: string) {
    if (!this.options?.resolveFileUrl) {
      return (await fetch(url)).blob();
    }
    const ret = await this.options.resolveFileUrl(url);
    if (ret instanceof Blob) {
      return ret;
    }
    return (await fetch(ret)).blob();
  }

  public mapStyles(styles: Styles<S>) {
    const stylesArray = Object.entries(styles).map(([key, value]) => {
      const mappedStyle = this.mappings.styleMapping[key](value, this);
      return mappedStyle;
    });
    return stylesArray;
  }

  public mapInlineContent(inlineContent: InlineContent<I, S>) {
    return this.mappings.inlineContentMapping[inlineContent.type](
      inlineContent,
      this,
    );
  }

  public transformInlineContent(inlineContentArray: InlineContent<I, S>[]) {
    return inlineContentArray.map((ic) => this.mapInlineContent(ic));
  }

  public abstract transformStyledText(styledText: StyledText<S>): TS;

  public async mapBlock(
    block: BlockFromConfig<B[keyof B], I, S>,
    nestingLevel: number,
    numberedListIndex: number,
    children?: Array<Awaited<RB>>,
  ) {
    const mapping = this.mappings.blockMapping[block.type];
    if (!mapping) {
      // Without this, a missing mapping surfaces as an opaque "is not a
      // function" TypeError. Container blocks are called out explicitly: they
      // have no sensible generic representation, so a mapping is required.
      throw new Error(
        this.isContainerBlock(block.type)
          ? `No mapping found for container block type "${block.type}" — container blocks require an explicit block mapping that places their children.`
          : `No mapping found for block type "${block.type}".`,
      );
    }
    return mapping(block, this, nestingLevel, numberedListIndex, children);
  }
}
