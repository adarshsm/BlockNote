import { NodeViewWrapper } from "@tiptap/react";
import { ComponentPropsWithoutRef, forwardRef, ReactNode } from "react";

export type ChildBlocksWrapperProps = ComponentPropsWithoutRef<"div"> & {
  children: ReactNode;
};

/**
 * The root element a container block's `render` should return.
 *
 * A container block owns its outer DOM: BlockNote adds no `blockContent`
 * wrapper around it, and its content target holds child blocks rather than
 * inline content. This component wraps Tiptap's `NodeViewWrapper` (so
 * ProseMirror recognizes the node view's element) and spreads everything
 * else through.
 *
 * The attributes BlockNote relies on (`data-node-type`, `data-id`, and each
 * non-default prop as a `data-*` attribute) are applied by
 * `applyContainerAttributes` in `@blocknote/core` — a container render
 * doesn't set them itself.
 */
export const ChildBlocksWrapper = forwardRef<
  HTMLDivElement,
  ChildBlocksWrapperProps
>(({ children, ...rest }, ref) => (
  <NodeViewWrapper ref={ref} {...rest}>
    {children}
  </NodeViewWrapper>
));

ChildBlocksWrapper.displayName = "ChildBlocksWrapper";
