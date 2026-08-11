import { ChildBlocksWrapper, createReactBlockSpec } from "@blocknote/react";
import { MdCheckCircle, MdInfo, MdLightbulb, MdWarning } from "react-icons/md";

import "./styles.css";

// The flavors of callout the user can switch between.
export const calloutTypes = [
  { value: "tip", title: "Tip", icon: MdLightbulb },
  { value: "info", title: "Info", icon: MdInfo },
  { value: "warning", title: "Warning", icon: MdWarning },
  { value: "success", title: "Success", icon: MdCheckCircle },
] as const;

// The Callout block. Declared with `content: "none"` plus the new
// `childBlocks` config — the block hosts arbitrary child blocks in its body,
// exposed at runtime as `block.children`.
//
// The callout's title demonstrates the complementary "string prop slot"
// pattern: content that shouldn't be part of the rich-text document (no
// formatting, comments, or multiplayer cursors needed) can live in a plain
// string prop, edited through a regular <input> rendered inside the block.
export const createCallout = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      flavor: {
        default: "tip",
        values: ["tip", "info", "warning", "success"],
      },
      title: {
        default: "",
      },
    },
    content: "none",
    childBlocks: {
      min: 1,
      defaultChildren: [{ type: "paragraph" }],
    },
  },
  {
    render: (props) => {
      const flavor =
        calloutTypes.find((c) => c.value === props.block.props.flavor) ??
        calloutTypes[0];
      const Icon = flavor.icon;

      const cycleFlavor = () => {
        const idx = calloutTypes.findIndex(
          (c) => c.value === props.block.props.flavor,
        );
        const next = calloutTypes[(idx + 1) % calloutTypes.length];
        props.editor.updateBlock(props.block, {
          type: "callout",
          props: { flavor: next.value },
        });
      };

      const commitTitle = (title: string) => {
        if (title !== props.block.props.title) {
          props.editor.updateBlock(props.block, {
            type: "callout",
            props: { title },
          });
        }
      };

      return (
        <ChildBlocksWrapper className={"callout"}>
          <button
            className={"callout-icon-button"}
            type={"button"}
            contentEditable={false}
            onClick={cycleFlavor}
            aria-label={`Cycle callout flavor (current: ${flavor.title})`}
            title={`Click to cycle flavor (current: ${flavor.title})`}
          >
            <Icon size={20} />
          </button>
          <div className={"callout-main"}>
            {/* The title lives in a string prop, not in document content —
                it's edited via a plain input. `contentEditable={false}` keeps
                ProseMirror from treating typing here as document input. */}
            <div className={"callout-title-wrapper"} contentEditable={false}>
              <input
                className={"callout-title-input"}
                placeholder={"Add title"}
                defaultValue={props.block.props.title}
                onBlur={(event) => commitTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
            <div className={"callout-body"} ref={props.contentRef} />
          </div>
        </ChildBlocksWrapper>
      );
    },
  },
);
