import { Extension } from "@tiptap/core";
import { Fragment, Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

import {
  getBottomNestedBlockInfo,
  getNextBlockInfo,
  getParentBlockInfo,
  getPrevBlockInfo,
  mergeBlocksCommand,
} from "../../../api/blockManipulation/commands/mergeBlocks/mergeBlocks.js";
import {
  liftItem,
  nestBlock,
  unnestBlock,
} from "../../../api/blockManipulation/commands/nestBlock/nestBlock.js";
import {
  fixContainersById,
  isContainerNode,
} from "../../../api/blockManipulation/containers/fixContainer.js";
import {
  ascendToInsertablePos,
  descendToLastInsertionPos,
  getAncestorContainers,
  getFirstLeafBlock,
} from "../../../api/blockManipulation/containers/containerNav.js";
import { splitBlockCommand } from "../../../api/blockManipulation/commands/splitBlock/splitBlock.js";
import { updateBlockCommand } from "../../../api/blockManipulation/commands/updateBlock/updateBlock.js";
import {
  getBlockInfoFromResolvedPos,
  getBlockInfoFromSelection,
} from "../../../api/getBlockInfoFromPos.js";
import { BlockNoteEditor } from "../../../editor/BlockNoteEditor.js";
import { FilePanelExtension } from "../../FilePanel/FilePanel.js";
import { FormattingToolbarExtension } from "../../FormattingToolbar/FormattingToolbar.js";

export const KeyboardShortcutsExtension = Extension.create<{
  editor: BlockNoteEditor<any, any, any>;
  tabBehavior: "prefer-navigate-ui" | "prefer-indent";
}>({
  priority: 50,

  // TODO: The shortcuts need a refactor. Do we want to use a command priority
  //  design as there is now, or clump the logic into a single function?
  addKeyboardShortcuts() {
    // handleBackspace is partially adapted from https://github.com/ueberdosis/tiptap/blob/ed56337470efb4fd277128ab7ef792b37cfae992/packages/core/src/extensions/keymap.ts
    const handleBackspace = () =>
      this.editor.commands.first(({ chain, commands }) => [
        // Deletes the selection if it's not empty.
        () => commands.deleteSelection(),
        // Undoes an input rule if one was triggered in the last editor state change.
        () => commands.undoInputRule(),
        // Reverts block content type to a paragraph if the selection is at the start of the block.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockStart =
              state.selection.from === blockInfo.blockContent.beforePos + 1;
            const isParagraph =
              blockInfo.blockContent.node.type.name === "paragraph";

            if (selectionAtBlockStart && !isParagraph) {
              return commands.command(
                updateBlockCommand(blockInfo.bnBlock.beforePos, {
                  type: "paragraph",
                  props: {},
                }),
              );
            }

            return false;
          }),
        // Removes a level of nesting if the block is indented if the selection is at the start of the block.
        () =>
          commands.command(({ state, tr }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { blockContent } = blockInfo;

            const selectionAtBlockStart =
              state.selection.from === blockContent.beforePos + 1;

            if (selectionAtBlockStart) {
              return liftItem(
                tr,
                tr.doc.type.schema.nodes["blockContainer"],
                tr.doc.type.schema.nodes["blockGroup"],
              );
            }

            return false;
          }),
        // Merges block with the previous one if it isn't indented, and the selection is at the start of the
        // block. The target block for merging must contain inline content.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { bnBlock: blockContainer, blockContent } = blockInfo;

            const prevBlockInfo = getPrevBlockInfo(
              state.doc,
              blockInfo.bnBlock.beforePos,
            );
            // If the previous block has no inline content, it can't be merged.
            // It's instead deleted, which is done later in the chan, so we
            // return early here.
            if (
              !prevBlockInfo ||
              !prevBlockInfo.isBlockContainer ||
              prevBlockInfo.blockContent.node.type.spec.content !== "inline*"
            ) {
              return false;
            }

            const selectionAtBlockStart =
              state.selection.from === blockContent.beforePos + 1;
            const selectionEmpty = state.selection.empty;

            const posBetweenBlocks = blockContainer.beforePos;

            if (selectionAtBlockStart && selectionEmpty) {
              return chain()
                .command(mergeBlocksCommand(posBetweenBlocks))
                .scrollIntoView()
                .run();
            }

            return false;
          }),
        // If the previous block is a container (e.g. a columnList or a
        // callout), moves the current block to its deepest trailing insertion
        // slot — descending through nested containers, e.g. to the end of the
        // last column.
        () =>
          commands.command(({ state, tr, dispatch }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockStart =
              state.selection.from === blockInfo.blockContent.beforePos + 1;
            if (!selectionAtBlockStart) {
              return false;
            }

            const prevBlockInfo = getPrevBlockInfo(
              state.doc,
              blockInfo.bnBlock.beforePos,
            );
            if (!prevBlockInfo || prevBlockInfo.isBlockContainer) {
              return false;
            }

            const insertionPos = descendToLastInsertionPos(
              prevBlockInfo.bnBlock.node,
              prevBlockInfo.bnBlock.beforePos,
              state.schema.nodes["blockContainer"],
            );
            if (insertionPos === null) {
              return false;
            }

            if (dispatch) {
              tr.delete(
                blockInfo.bnBlock.beforePos,
                blockInfo.bnBlock.afterPos,
              );
              tr.insert(insertionPos, blockInfo.bnBlock.node);
              tr.setSelection(
                TextSelection.near(tr.doc.resolve(insertionPos + 1)),
              );

              return true;
            }

            return false;
          }),
        // If the block is the first in a container (e.g. a column or a
        // callout), moves it out: to the end of the previous sibling
        // container if there is one (e.g. the previous column), otherwise to
        // just before the closest enclosing boundary that accepts it (e.g.
        // above the columnList / callout).
        () =>
          commands.command(({ state, tr, dispatch }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockStart =
              tr.selection.from === blockInfo.blockContent.beforePos + 1;
            if (!selectionAtBlockStart) {
              return false;
            }

            const $pos = tr.doc.resolve(blockInfo.bnBlock.beforePos);

            const prevBlock = $pos.nodeBefore;
            if (prevBlock) {
              return false;
            }

            const parentBlock = $pos.node();
            if (!isContainerNode(parentBlock.type)) {
              return false;
            }

            const blockContainerType = state.schema.nodes["blockContainer"];
            const containerBeforePos = $pos.before();
            const $containerPos = tr.doc.resolve(containerBeforePos);

            // A previous sibling inside an enclosing container (e.g. the
            // previous column) is a target to descend into. A sibling at a
            // regular block position is not — there the block moves out to
            // before the container instead.
            const prevSibling =
              isContainerNode($containerPos.node().type) &&
              $containerPos.nodeBefore &&
              isContainerNode($containerPos.nodeBefore.type)
                ? $containerPos.nodeBefore
                : null;

            const insertionPos = prevSibling
              ? descendToLastInsertionPos(
                  prevSibling,
                  containerBeforePos - prevSibling.nodeSize,
                  blockContainerType,
                )
              : ascendToInsertablePos(
                  tr.doc,
                  containerBeforePos,
                  blockContainerType,
                );
            if (insertionPos === null) {
              return false;
            }

            if (dispatch) {
              const containersToFix = getAncestorContainers(
                tr.doc,
                blockInfo.bnBlock.beforePos,
              );

              tr.delete(
                blockInfo.bnBlock.beforePos,
                blockInfo.bnBlock.afterPos,
              );
              tr.insert(insertionPos, blockInfo.bnBlock.node);
              fixContainersById(tr, containersToFix);
              tr.setSelection(
                TextSelection.near(tr.doc.resolve(insertionPos + 1)),
              );
            }

            return true;
          }),
        // Deletes the current block if it's an empty block with inline content,
        // and moves the selection to the previous block.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const blockEmpty =
              blockInfo.blockContent.node.childCount === 0 &&
              blockInfo.blockContent.node.type.spec.content === "inline*";

            if (blockEmpty) {
              const prevBlockInfo = getPrevBlockInfo(
                state.doc,
                blockInfo.bnBlock.beforePos,
              );
              if (!prevBlockInfo) {
                return false;
              }
              const bottomNestedPrevBlockInfo = getBottomNestedBlockInfo(
                state.doc,
                prevBlockInfo,
              );
              if (!bottomNestedPrevBlockInfo.isBlockContainer) {
                return false;
              }
              if (
                !bottomNestedPrevBlockInfo ||
                !bottomNestedPrevBlockInfo.isBlockContainer
              ) {
                return false;
              }

              let chainedCommands = chain();

              // Moves the children the current block.
              if (blockInfo.childContainer) {
                chainedCommands.insertContentAt(
                  blockInfo.bnBlock.afterPos,
                  blockInfo.childContainer?.node.content,
                );
              }

              if (
                bottomNestedPrevBlockInfo.blockContent.node.type.spec
                  .content === "tableRow+"
              ) {
                const tableBlockEndPos = blockInfo.bnBlock.beforePos - 1;
                const tableBlockContentEndPos = tableBlockEndPos - 1;
                const lastRowEndPos = tableBlockContentEndPos - 1;
                const lastCellEndPos = lastRowEndPos - 1;
                const lastCellParagraphEndPos = lastCellEndPos - 1;

                chainedCommands = chainedCommands.setTextSelection(
                  lastCellParagraphEndPos,
                );
              } else if (
                bottomNestedPrevBlockInfo.blockContent.node.type.spec
                  .content === ""
              ) {
                chainedCommands = chainedCommands.setNodeSelection(
                  bottomNestedPrevBlockInfo.blockContent.beforePos,
                );
              } else {
                const blockContentEndPos =
                  bottomNestedPrevBlockInfo.blockContent.afterPos - 1;

                chainedCommands =
                  chainedCommands.setTextSelection(blockContentEndPos);
              }

              return chainedCommands
                .deleteRange({
                  from: blockInfo.bnBlock.beforePos,
                  to: blockInfo.bnBlock.afterPos,
                })
                .scrollIntoView()
                .run();
            }

            return false;
          }),
        // Deletes previous block if it contains no content and isn't a table,
        // when the selection is empty and at the start of the block. Moves the
        // current block into the deleted block's place.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);

            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockStart =
              state.selection.from === blockInfo.blockContent.beforePos + 1;
            const selectionEmpty = state.selection.empty;

            const prevBlockInfo = getPrevBlockInfo(
              state.doc,
              blockInfo.bnBlock.beforePos,
            );

            if (prevBlockInfo && selectionAtBlockStart && selectionEmpty) {
              const bottomBlock = getBottomNestedBlockInfo(
                state.doc,
                prevBlockInfo,
              );

              if (!bottomBlock.isBlockContainer) {
                return false;
              }

              const prevBlockNotTableAndNoContent =
                bottomBlock.blockContent.node.type.spec.content === "" ||
                (bottomBlock.blockContent.node.type.spec.content ===
                  "inline*" &&
                  bottomBlock.blockContent.node.childCount === 0);

              if (prevBlockNotTableAndNoContent) {
                return chain()
                  .cut(
                    {
                      from: blockInfo.bnBlock.beforePos,
                      to: blockInfo.bnBlock.afterPos,
                    },
                    bottomBlock.bnBlock.afterPos,
                  )
                  .deleteRange({
                    from: bottomBlock.bnBlock.beforePos,
                    to: bottomBlock.bnBlock.afterPos,
                  })
                  .run();
              }
            }

            return false;
          }),
      ]);

    const handleDelete = () =>
      this.editor.commands.first(({ chain, commands }) => [
        // Deletes the selection if it's not empty.
        () => commands.deleteSelection(),
        // Deletes the first child block and un-nests its children, if the
        // selection is empty and at the end of the current block. If both the
        // parent and child blocks have inline content, the child block's
        // content is appended to the parent's. The child block's own children
        // are unindented before it's deleted.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer || !blockInfo.childContainer) {
              return false;
            }
            const { blockContent, childContainer } = blockInfo;

            const selectionAtBlockEnd =
              state.selection.from === blockContent.afterPos - 1;
            const selectionEmpty = state.selection.empty;

            const firstChildBlockInfo = getBlockInfoFromResolvedPos(
              state.doc.resolve(childContainer.beforePos + 1),
            );
            if (!firstChildBlockInfo.isBlockContainer) {
              return false;
            }

            if (selectionAtBlockEnd && selectionEmpty) {
              const firstChildBlockContent =
                firstChildBlockInfo.blockContent.node;
              const firstChildBlockHasInlineContent =
                firstChildBlockContent.type.spec.content === "inline*";
              const blockHasInlineContent =
                blockContent.node.type.spec.content === "inline*";

              return (
                chain()
                  // Un-nests child block's children if necessary.
                  .insertContentAt(
                    firstChildBlockInfo.bnBlock.afterPos,
                    firstChildBlockInfo.childContainer?.node.content ||
                      Fragment.empty,
                  )
                  .deleteRange(
                    // Deletes whole child container if there's only one child.
                    childContainer.node.childCount === 1
                      ? {
                          from: childContainer.beforePos,
                          to: childContainer.afterPos,
                        }
                      : {
                          from: firstChildBlockInfo.bnBlock.beforePos,
                          to: firstChildBlockInfo.bnBlock.afterPos,
                        },
                  )
                  // Appends inline content from child block if possible.
                  .insertContentAt(
                    state.selection.from,
                    firstChildBlockHasInlineContent && blockHasInlineContent
                      ? firstChildBlockContent.content
                      : null,
                  )
                  .setTextSelection(state.selection.from)
                  .scrollIntoView()
                  .run()
              );
            }

            return false;
          }),
        // Merges block with the next one (at the same nesting level or lower),
        // if one exists, the block has no children, and the selection is at the
        // end of the block.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { bnBlock: blockContainer, blockContent } = blockInfo;

            const nextBlockInfo = getNextBlockInfo(
              state.doc,
              blockInfo.bnBlock.beforePos,
            );
            if (!nextBlockInfo || !nextBlockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockEnd =
              state.selection.from === blockContent.afterPos - 1;
            const selectionEmpty = state.selection.empty;

            const posBetweenBlocks = blockContainer.afterPos;

            if (selectionAtBlockEnd && selectionEmpty) {
              return chain()
                .command(mergeBlocksCommand(posBetweenBlocks))
                .scrollIntoView()
                .run();
            }

            return false;
          }),
        // If the next block is a container (e.g. a columnList or a callout),
        // moves its first leaf block out, to after the current block.
        () =>
          commands.command(({ state, tr, dispatch }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockEnd =
              state.selection.from === blockInfo.blockContent.afterPos - 1;
            if (!selectionAtBlockEnd) {
              return false;
            }

            const nextBlockInfo = getNextBlockInfo(
              state.doc,
              blockInfo.bnBlock.beforePos,
            );
            if (!nextBlockInfo || nextBlockInfo.isBlockContainer) {
              return false;
            }

            const firstLeaf = getFirstLeafBlock(
              nextBlockInfo.bnBlock.node,
              nextBlockInfo.bnBlock.beforePos,
            );
            if (!firstLeaf) {
              return false;
            }

            if (dispatch) {
              const containersToFix = getAncestorContainers(
                tr.doc,
                firstLeaf.beforePos,
              );

              tr.delete(
                firstLeaf.beforePos,
                firstLeaf.beforePos + firstLeaf.node.nodeSize,
              );
              tr.insert(blockInfo.bnBlock.afterPos, firstLeaf.node);
              fixContainersById(tr, containersToFix);
              tr.setSelection(
                TextSelection.near(tr.doc.resolve(firstLeaf.beforePos)),
              );

              return true;
            }

            return false;
          }),
        // If the block is the last in a container (e.g. a column or a
        // callout), moves the next block — the first leaf of the next sibling
        // container, or the block following the enclosing containers — to
        // after it.
        () =>
          commands.command(({ state, tr, dispatch }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockEnd =
              tr.selection.from === blockInfo.blockContent.afterPos - 1;
            if (!selectionAtBlockEnd) {
              return false;
            }

            const $pos = tr.doc.resolve(blockInfo.bnBlock.afterPos);

            const nextBlock = $pos.nodeAfter;
            if (nextBlock) {
              return false;
            }

            const parentBlock = $pos.node();
            if (!isContainerNode(parentBlock.type)) {
              return false;
            }

            // Climbs out of the containers the block is the last child of,
            // to the first position with a following node.
            let $boundary = $pos;
            while (
              $boundary.nodeAfter === null &&
              $boundary.depth > 0 &&
              isContainerNode($boundary.node().type)
            ) {
              $boundary = tr.doc.resolve($boundary.after());
            }

            const nextNode = $boundary.nodeAfter;
            if (!nextNode) {
              return false;
            }

            // The block to pull in: the next node itself or — when it's a
            // container — its first leaf block.
            const target = isContainerNode(nextNode.type)
              ? getFirstLeafBlock(nextNode, $boundary.pos)
              : { node: nextNode, beforePos: $boundary.pos };
            if (!target) {
              return false;
            }

            if (dispatch) {
              const containersToFix = getAncestorContainers(
                tr.doc,
                target.beforePos,
              );

              tr.delete(
                target.beforePos,
                target.beforePos + target.node.nodeSize,
              );
              tr.insert(blockInfo.bnBlock.afterPos, target.node);
              fixContainersById(tr, containersToFix);
              tr.setSelection(
                TextSelection.near(tr.doc.resolve(target.beforePos)),
              );
            }

            return true;
          }),
        // Deletes the next block at either the same or lower nesting level, if
        // the selection is empty and at the end of the block. If both the
        // current and next blocks have inline content, the next block's
        // content is appended to the current block's. The next block's own
        // children are unindented before it's deleted.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { blockContent } = blockInfo;

            const selectionAtBlockEnd =
              state.selection.from === blockContent.afterPos - 1;
            const selectionEmpty = state.selection.empty;

            if (selectionAtBlockEnd && selectionEmpty) {
              const getNextBlockInfoAtAnyLevel = (
                doc: Node,
                beforePos: number,
              ) => {
                const nextBlockInfo = getNextBlockInfo(doc, beforePos);
                if (nextBlockInfo) {
                  return nextBlockInfo;
                }

                const parentBlockInfo = getParentBlockInfo(doc, beforePos);
                if (!parentBlockInfo) {
                  return undefined;
                }

                return getNextBlockInfoAtAnyLevel(
                  doc,
                  parentBlockInfo.bnBlock.beforePos,
                );
              };

              const nextBlockInfo = getNextBlockInfoAtAnyLevel(
                state.doc,
                blockInfo.bnBlock.beforePos,
              );
              if (!nextBlockInfo || !nextBlockInfo.isBlockContainer) {
                return false;
              }

              const nextBlockContent = nextBlockInfo.blockContent.node;
              const nextBlockHasInlineContent =
                nextBlockContent.type.spec.content === "inline*";
              const blockHasInlineContent =
                blockContent.node.type.spec.content === "inline*";

              return (
                chain()
                  // Un-nests next block's children if necessary.
                  .insertContentAt(
                    nextBlockInfo.bnBlock.afterPos,
                    nextBlockInfo.childContainer?.node.content ||
                      Fragment.empty,
                  )
                  .deleteRange({
                    from: nextBlockInfo.bnBlock.beforePos,
                    to: nextBlockInfo.bnBlock.afterPos,
                  })
                  // Appends inline content from child block if possible.
                  .insertContentAt(
                    state.selection.from,
                    nextBlockHasInlineContent && blockHasInlineContent
                      ? nextBlockContent.content
                      : null,
                  )
                  .setTextSelection(state.selection.from)
                  .scrollIntoView()
                  .run()
              );
            }

            return false;
          }),
        // Deletes the current block if it's an empty block with inline content,
        // and moves the selection to the next block.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const blockEmpty =
              blockInfo.blockContent.node.childCount === 0 &&
              blockInfo.blockContent.node.type.spec.content === "inline*";

            if (blockEmpty) {
              const nextBlockInfo = getNextBlockInfo(
                state.doc,
                blockInfo.bnBlock.beforePos,
              );
              if (!nextBlockInfo || !nextBlockInfo.isBlockContainer) {
                return false;
              }

              let chainedCommands = chain();

              if (
                nextBlockInfo.blockContent.node.type.spec.content ===
                "tableRow+"
              ) {
                const tableBlockStartPos = blockInfo.bnBlock.afterPos + 1;
                const tableBlockContentStartPos = tableBlockStartPos + 1;
                const firstRowStartPos = tableBlockContentStartPos + 1;
                const firstCellStartPos = firstRowStartPos + 1;
                const firstCellParagraphStartPos = firstCellStartPos + 1;

                chainedCommands = chainedCommands.setTextSelection(
                  firstCellParagraphStartPos,
                );
              } else if (
                nextBlockInfo.blockContent.node.type.spec.content === ""
              ) {
                chainedCommands = chainedCommands.setNodeSelection(
                  nextBlockInfo.blockContent.beforePos,
                );
              } else {
                chainedCommands = chainedCommands.setTextSelection(
                  nextBlockInfo.blockContent.beforePos + 1,
                );
              }

              return chainedCommands
                .deleteRange({
                  from: blockInfo.bnBlock.beforePos,
                  to: blockInfo.bnBlock.afterPos,
                })
                .scrollIntoView()
                .run();
            }

            return false;
          }),
        // Deletes next block if it contains no content and isn't a table,
        // when the selection is empty and at the end of the block. Moves the
        // current block into the deleted block's place.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);

            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionAtBlockEnd =
              state.selection.from === blockInfo.blockContent.afterPos - 1;
            const selectionEmpty = state.selection.empty;

            const nextBlockInfo = getNextBlockInfo(
              state.doc,
              blockInfo.bnBlock.beforePos,
            );
            if (!nextBlockInfo) {
              return false;
            }
            if (!nextBlockInfo.isBlockContainer) {
              return false;
            }

            if (nextBlockInfo && selectionAtBlockEnd && selectionEmpty) {
              const nextBlockNotTableAndNoContent =
                nextBlockInfo.blockContent.node.type.spec.content === "" ||
                (nextBlockInfo.blockContent.node.type.spec.content ===
                  "inline*" &&
                  nextBlockInfo.blockContent.node.childCount === 0);

              if (nextBlockNotTableAndNoContent) {
                const childBlocks =
                  nextBlockInfo.bnBlock.node.lastChild!.content;
                return chain()
                  .deleteRange({
                    from: nextBlockInfo.bnBlock.beforePos,
                    to: nextBlockInfo.bnBlock.afterPos,
                  })
                  .insertContentAt(
                    blockInfo.bnBlock.afterPos,
                    nextBlockInfo.bnBlock.node.childCount === 2
                      ? childBlocks
                      : null,
                  )
                  .run();
              }
            }

            return false;
          }),
      ]);

    const handleEnter = (withShift = false) => {
      return this.editor.commands.first(({ commands, tr }) => [
        // Removes a level of nesting if the block is empty & indented, while the selection is also empty & at the start
        // of the block.
        () =>
          commands.command(({ state, tr }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { bnBlock: blockContainer, blockContent } = blockInfo;

            const { depth } = state.doc.resolve(blockContainer.beforePos);

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const selectionEmpty =
              state.selection.anchor === state.selection.head;
            const blockEmpty = blockContent.node.childCount === 0;
            const blockIndented = depth > 1;

            if (
              selectionAtBlockStart &&
              selectionEmpty &&
              blockEmpty &&
              blockIndented
            ) {
              return liftItem(
                tr,
                tr.doc.type.schema.nodes["blockContainer"],
                tr.doc.type.schema.nodes["blockGroup"],
              );
            }

            return false;
          }),
        // Creates a hard break if block is configured to do so.
        () =>
          commands.command(({ state }) => {
            const blockInfo = getBlockInfoFromSelection(state);

            const blockHardBreakShortcut =
              this.options.editor.schema.blockSpecs[blockInfo.blockNoteType]
                ?.implementation?.meta?.hardBreakShortcut ?? "shift+enter";

            if (blockHardBreakShortcut === "none") {
              return false;
            }

            if (
              // If shortcut is not configured, or is configured as "shift+enter",
              // create a hard break for shift+enter, but not for enter.
              (blockHardBreakShortcut === "shift+enter" && withShift) ||
              // If shortcut is configured as "enter", create a hard break for
              // both enter and shift+enter.
              blockHardBreakShortcut === "enter"
            ) {
              const marks =
                tr.storedMarks ||
                tr.selection.$head
                  .marks()
                  .filter((m) =>
                    this.editor.extensionManager.splittableMarks.includes(
                      m.type.name,
                    ),
                  );

              tr.insert(
                tr.selection.head,
                tr.doc.type.schema.nodes.hardBreak.create(),
              ).ensureMarks(marks);
              return true;
            }

            return false;
          }),
        // If the block is empty and the last child of a container with
        // `exitOnEnter` behavior (the default for containers), moves the
        // block out to after the container — one level per press, list-style.
        // Without this, Enter only ever creates new blocks *within* the
        // container, so a trailing container could trap the cursor.
        () =>
          commands.command(({ state, tr, dispatch }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }

            const selectionEmpty =
              state.selection.anchor === state.selection.head;
            const blockEmpty = blockInfo.blockContent.node.childCount === 0;
            if (!selectionEmpty || !blockEmpty) {
              return false;
            }

            const $pos = tr.doc.resolve(blockInfo.bnBlock.beforePos);
            const parentBlock = $pos.node();
            if (!isContainerNode(parentBlock.type)) {
              return false;
            }

            // Only fires on the container's last child.
            if (tr.doc.resolve(blockInfo.bnBlock.afterPos).nodeAfter !== null) {
              return false;
            }

            const exitOnEnter =
              this.options.editor.schema.blockSpecs[parentBlock.type.name]
                ?.implementation?.meta?.exitOnEnter ?? true;
            if (!exitOnEnter) {
              return false;
            }

            const containerAfterPos = $pos.after();

            if (dispatch) {
              const containersToFix = getAncestorContainers(
                tr.doc,
                blockInfo.bnBlock.beforePos,
              );

              tr.delete(
                blockInfo.bnBlock.beforePos,
                blockInfo.bnBlock.afterPos,
              );
              // The container's after-position, mapped through the deletion
              // (and any schema-driven refill it triggered).
              const insertionPos = tr.mapping.map(containerAfterPos);
              tr.insert(insertionPos, blockInfo.bnBlock.node);
              fixContainersById(tr, containersToFix);
              tr.setSelection(
                TextSelection.near(tr.doc.resolve(insertionPos + 1)),
              );
              tr.scrollIntoView();
            }

            return true;
          }),
        // Creates a new block and moves the selection to it if the current one is empty, while the selection is also
        // empty & at the start of the block.
        () =>
          commands.command(({ state, dispatch, tr }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { bnBlock: blockContainer, blockContent } = blockInfo;

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const selectionEmpty =
              state.selection.anchor === state.selection.head;
            const blockEmpty = blockContent.node.childCount === 0;

            if (selectionAtBlockStart && selectionEmpty && blockEmpty) {
              const newBlockInsertionPos = blockContainer.afterPos;
              const newBlockContentPos = newBlockInsertionPos + 2;

              if (dispatch) {
                // Creates a new block with the children of the current block,
                // if it has any.
                const newBlock = state.schema.nodes[
                  "blockContainer"
                ].createAndFill(
                  undefined,
                  [
                    state.schema.nodes["paragraph"].createAndFill() ||
                      undefined,
                    blockInfo.childContainer?.node,
                  ].filter((node) => node !== undefined),
                )!;

                // Inserts the new block and moves the selection to it.
                tr.insert(newBlockInsertionPos, newBlock)
                  .setSelection(
                    new TextSelection(tr.doc.resolve(newBlockContentPos)),
                  )
                  .scrollIntoView();

                // Deletes old block's children, as they have been moved to
                // the new one.
                if (blockInfo.childContainer) {
                  tr.delete(
                    blockInfo.childContainer.beforePos,
                    blockInfo.childContainer.afterPos,
                  );
                }
              }

              return true;
            }

            return false;
          }),
        // Splits the current block, moving content inside that's after the cursor to a new text block below. Also
        // deletes the selection beforehand, if it's not empty.
        () =>
          commands.command(({ state, chain }) => {
            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) {
              return false;
            }
            const { blockContent } = blockInfo;

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const blockEmpty = blockContent.node.childCount === 0;

            if (!blockEmpty) {
              chain()
                .deleteSelection()
                .command(
                  splitBlockCommand(
                    state.selection.from,
                    selectionAtBlockStart,
                    selectionAtBlockStart,
                  ),
                )
                .scrollIntoView()
                .run();

              return true;
            }

            return false;
          }),
      ]);
    };

    return {
      Backspace: handleBackspace,
      Delete: handleDelete,
      Enter: () => handleEnter(),
      "Shift-Enter": () => handleEnter(true),
      // Always returning true for tab key presses ensures they're not captured by the browser. Otherwise, they blur the
      // editor since the browser will try to use tab for keyboard navigation.
      Tab: () => {
        if (
          this.options.tabBehavior !== "prefer-indent" &&
          (this.options.editor.getExtension(FormattingToolbarExtension)?.store
            .state ||
            this.options.editor.getExtension(FilePanelExtension)?.store
              .state !== undefined)
          // TODO need to check if the link toolbar is open or another alternative entirely
        ) {
          // don't handle tabs if a toolbar is shown, so we can tab into / out of it
          return false;
        }
        return nestBlock(this.options.editor);
      },
      "Shift-Tab": () => {
        if (
          this.options.tabBehavior !== "prefer-indent" &&
          (this.options.editor.getExtension(FormattingToolbarExtension)?.store
            .state ||
            this.options.editor.getExtension(FilePanelExtension)?.store
              .state !== undefined)
          // TODO need to check if the link toolbar is open or another alternative entirely
          // other menu types?
        ) {
          // don't handle tabs if a toolbar is shown, so we can tab into / out of it
          return false;
        }
        return unnestBlock(this.options.editor);
      },
      "Shift-Mod-ArrowUp": () => {
        this.options.editor.moveBlocksUp();
        return true;
      },
      "Shift-Mod-ArrowDown": () => {
        this.options.editor.moveBlocksDown();
        return true;
      },
      "Mod-z": () => this.options.editor.undo(),
      "Mod-y": () => this.options.editor.redo(),
      "Shift-Mod-z": () => this.options.editor.redo(),
    };
  },
});
