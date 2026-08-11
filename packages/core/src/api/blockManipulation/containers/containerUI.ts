import type { BlockNoteEditor } from "../../../editor/BlockNoteEditor.js";
import { isContainerType } from "../../../schema/blocks/childBlocks.js";

export type ContainerUIInfo = {
  containerTypes: ReadonlySet<string>;
  draggableContainerTypes: ReadonlySet<string>;
  containerSelector: string | null;
};

function buildSelector(types: ReadonlySet<string>): string | null {
  if (types.size === 0) {
    return null;
  }
  return [...types].map((type) => `[data-node-type="${type}"]`).join(",");
}

export function getContainerUIInfo(
  editor: Pick<BlockNoteEditor<any, any, any>, "schema">,
): ContainerUIInfo {
  const containerTypes = new Set<string>();
  const draggableContainerTypes = new Set<string>();

  for (const [type, spec] of Object.entries(
    editor.schema.blockSpecs as Record<
      string,
      {
        config: any;
        implementation?: { meta?: { draggable?: boolean } };
      }
    >,
  )) {
    if (!isContainerType(spec.config)) {
      continue;
    }
    containerTypes.add(type);
    if (spec.implementation?.meta?.draggable !== false) {
      draggableContainerTypes.add(type);
    }
  }

  return {
    containerTypes,
    draggableContainerTypes,
    containerSelector: buildSelector(containerTypes),
  };
}
