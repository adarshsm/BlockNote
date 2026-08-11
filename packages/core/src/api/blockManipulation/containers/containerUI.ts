import { isContainerType } from "../../../schema/blocks/internal.js";

/**
 * Schema-derived info about the container block types in an editor, consumed
 * by UI code (side menu positioning, drag & drop). Container DOM always
 * carries `data-node-type`, so container elements can be matched with CSS
 * selectors built from the type names.
 */
export type ContainerUIInfo = {
  /** All container block types (blocks holding child blocks directly). */
  containerTypes: ReadonlySet<string>;
  /** Container types whose children are laid out side-by-side. */
  horizontalContainerTypes: ReadonlySet<string>;
  /** Container types that get their own side-menu drag handle. */
  draggableContainerTypes: ReadonlySet<string>;
  /** Selector matching any container element, or null if there are none. */
  containerSelector: string | null;
  /** Selector matching horizontal container elements, or null if none. */
  horizontalContainerSelector: string | null;
};

// Minimal structural view of the editor, to avoid depending on the full
// BlockNoteEditor type here. `blockSpecs` is a schema-specific mapped type
// on the editor, so it is accepted loosely and read defensively below.
type EditorWithSchema = {
  schema: {
    blockSpecs: any;
  };
};

const cache = new WeakMap<object, ContainerUIInfo>();

function buildSelector(types: ReadonlySet<string>): string | null {
  if (types.size === 0) {
    return null;
  }
  return [...types].map((type) => `[data-node-type="${type}"]`).join(",");
}

/**
 * Returns (and caches per editor) the container-type info derived from the
 * editor's block schema.
 */
export function getContainerUIInfo(editor: EditorWithSchema): ContainerUIInfo {
  const cached = cache.get(editor);
  if (cached) {
    return cached;
  }

  const containerTypes = new Set<string>();
  const horizontalContainerTypes = new Set<string>();
  const draggableContainerTypes = new Set<string>();

  for (const [type, spec] of Object.entries(
    editor.schema.blockSpecs as Record<
      string,
      {
        config: any;
        implementation?: {
          meta?: {
            childLayout?: "vertical" | "horizontal";
            draggable?: boolean;
          };
          node?: { config?: { group?: string } };
        };
      }
    >,
  )) {
    if (!isContainerType(editor.schema.blockSpecs, type)) {
      continue;
    }

    containerTypes.add(type);
    const meta = spec.implementation?.meta;
    if (meta?.childLayout === "horizontal") {
      horizontalContainerTypes.add(type);
    }
    if (meta?.draggable !== false) {
      draggableContainerTypes.add(type);
    }
  }

  const info: ContainerUIInfo = {
    containerTypes,
    horizontalContainerTypes,
    draggableContainerTypes,
    containerSelector: buildSelector(containerTypes),
    horizontalContainerSelector: buildSelector(horizontalContainerTypes),
  };
  cache.set(editor, info);
  return info;
}
