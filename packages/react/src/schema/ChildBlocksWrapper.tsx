import { BlockNoteEditor, camelToDataKebab } from "@blocknote/core";
import { NodeViewWrapper } from "@tiptap/react";
import { HTMLAttributes, ReactNode } from "react";

/**
 * The root element for a container block's `render`. Container blocks own
 * their outer DOM entirely (the framework doesn't wrap them in a
 * `blockContent` div), so their root element must carry the attributes
 * BlockNote relies on for HTML parsing and UI positioning. This component
 * applies them automatically:
 *
 * - `data-node-type` — keys the block's HTML parse rule and the side menu /
 *   drag-and-drop selectors.
 * - `data-id` — the block's id.
 * - each non-default prop as a kebab-cased `data-*` attribute, so props
 *   round-trip through HTML serialization.
 *
 * Any other props (`className`, event handlers, additional attributes) are
 * spread onto the element; explicitly passed attributes win over the
 * generated ones.
 */
export function ChildBlocksWrapper(
  props: {
    block: {
      id: string;
      type: string;
      props: Record<string, any>;
    };
    editor: BlockNoteEditor<any, any, any>;
    children: ReactNode;
  } & Omit<HTMLAttributes<HTMLDivElement>, "children">,
) {
  const { block, editor, children, ...rest } = props;

  const propSchema =
    (editor.schema.blockSchema as Record<string, any>)[block.type]
      ?.propSchema ?? {};

  // Non-default props as kebab-cased `data-*` attributes — the same
  // convention `propsToAttributes` parses back out of pasted/exported HTML.
  const propAttributes = Object.fromEntries(
    Object.entries(block.props ?? {})
      .filter(([prop, value]) => value !== propSchema[prop]?.default)
      .map(([prop, value]) => [camelToDataKebab(prop), value]),
  );

  return (
    <NodeViewWrapper
      data-node-type={block.type}
      data-id={block.id}
      {...propAttributes}
      {...rest}
    >
      {children}
    </NodeViewWrapper>
  );
}
