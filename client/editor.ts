import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  EDITABLE_TYPES,
  type EditableType,
  editSiblings,
  LIST_TYPES,
  locate,
  NESTABLE,
  plainText,
  type RichItem,
  richTextRequest,
} from "../shared/edit";
import { type BlockChange, editRpc, type NotionPage } from "../shared/notion";
import { messages } from "./messages";
import type { Block } from "./Blocks";
import { pageKey } from "./data";

export interface BlockEditor {
  /** The block whose text is open in an input. */
  editing: string | null;
  start(id: string): void;
  /** Leaves edit mode unless another block took it over meanwhile. */
  stop(id: string): void;
  save(block: Block, richText: RichItem[]): void;
  check(block: Block): void;
  /** Adds a block below: `type` if given, else another list item after a list item and a paragraph after the rest. */
  insertAfter(block: Block, type?: EditableType): void;
  remove(block: Block): void;
  rename(title: RichItem[]): void;
  /** Both take the text now in the input and return true when they changed the page. */
  turnInto(block: Block, type: EditableType, richText: RichItem[]): boolean;
  act(block: Block, action: BlockAction, richText: RichItem[]): boolean;
  /** Goes up with each move or type change; inputs take it as their key so they open again on the changed block. */
  epoch: number;
}

export type BlockAction = "indent" | "outdent" | "up" | "down" | "duplicate" | "check" | "previous" | "next";

const flat = (blocks: Block[]): Block[] => blocks.flatMap((block) => [block, ...flat(block.children ?? [])]);
const drop = (blocks: Block[], id: string) => editSiblings(blocks, id, (list, i) => list.filter((_, j) => j !== i));
const putAfter = (blocks: Block[], id: string, block: Block) =>
  editSiblings(blocks, id, (list, i) => [...list.slice(0, i + 1), block, ...list.slice(i + 1)]);
const putInside = (blocks: Block[], id: string, block: Block) =>
  editSiblings(blocks, id, (list, i) =>
    list.map((item, j) =>
      j === i
        ? {
            ...item,
            has_children: true,
            children: [...(item.children ?? []), block],
          }
        : item,
    ),
  );
// A block made here keeps this ID on the page for good; `alias` in the editor knows the ID Notion gave it.
let serial = 0;
const localId = () => `local-${++serial}`;
const ID_FIELDS = ["blockId", "parentId", "afterId", "removeId"];
const parentOf = (block: Block): string | undefined => block.parent?.page_id ?? block.parent?.block_id;

/** Edits the open page: the page shows each change at once and Notion receives them one by one. */
export function useEditor(space: string | null, id: string): BlockEditor {
  const edit = useRpc(editRpc);
  const client = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation(messages);
  const [editing, setEditing] = useState<string | null>(null);
  // One edit at a time, so a later save never lands before an earlier one.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The page shows every change at once under IDs that never change; Notion's IDs for blocks made or remade here are looked up when a request leaves.
  const alias = useRef(new Map<string, string>());
  const [epoch, setEpoch] = useState(0);
  const key = pageKey(space, id);
  const page = () => client.getQueryData<NotionPage>(key);

  const setBlocks = (change: (blocks: Block[]) => Block[]) =>
    client.setQueryData<NotionPage>(key, (data) => data && { ...data, blocks: change(data.blocks as Block[]) });
  // Keeps the children loaded now; `block` can be an older render's copy.
  const replace = (block: Block) =>
    setBlocks((blocks) =>
      editSiblings(blocks, block.id, (list, i) => list.map((item, j) => (j === i ? { ...block, children: item.children } : item))),
    );
  const send = (change: BlockChange, done?: (block: Block | null) => void) => {
    const pageId = page()?.id;
    if (!pageId) return;
    queue.current = queue.current.then(() => {
      const sent = Object.fromEntries(
        Object.entries(change).map(([name, value]) => [
          name,
          ID_FIELDS.includes(name) ? (alias.current.get(value as string) ?? value) : value,
        ]),
      ) as BlockChange;
      return edit({ space, pageId, change: sent }).then(
        ({ block }) => done?.(block as Block | null),
        (error: unknown) => {
          toast.error(t("saveFailed", { message: (error as Error).message }));
          setEditing(null);
          // Shows what Notion actually has instead of the failed change.
          void client.invalidateQueries({ queryKey: key });
        },
      );
    });
  };

  // Sends a block the page already shows. With `remove`, the new block stands in for the one Notion has
  // under the same ID: Notion cannot move a block or change its type, so both remake it.
  const create = (block: Block, to: { parentId: string; afterId?: string }, remove = false) => {
    const value = block[block.type] ?? {};
    const props = {
      color: value.color,
      checked: value.checked,
      language: value.language,
      emoji: value.icon?.emoji,
    };
    send(
      {
        op: "insert",
        ...to,
        type: block.type as EditableType,
        richText: richTextRequest(value.rich_text ?? []),
        removeId: remove ? block.id : undefined,
        props,
      },
      (created) => created && alias.current.set(block.id, created.id),
    );
  };
  const withText = (block: Block, richText: RichItem[], type = block.type): Block => ({
    ...block,
    type,
    [type]: type === block.type ? { ...block[type], rich_text: richText } : { rich_text: richText, color: block[block.type]?.color },
  });
  const remake = (moved: Block, to: { parentId: string; afterId?: string }, apply: (blocks: Block[]) => Block[]) => {
    setBlocks(apply);
    setEpoch((count) => count + 1);
    create(moved, to, true);
  };
  // Deleting a block deletes its children, so a block that has any stays where it is.
  const movable = (block: Block) => {
    if (block.has_children) toast.error(t("cannotMove"));
    return !block.has_children && (EDITABLE_TYPES as readonly string[]).includes(block.type);
  };

  return {
    turnInto(block, type, richText) {
      const parentId = parentOf(block);
      if (type === block.type || !parentId || !movable(block)) return false;
      const turned = withText(block, richText, type);
      remake(turned, { parentId, afterId: block.id }, (blocks) =>
        editSiblings(blocks, block.id, (list, i) => list.map((item, j) => (j === i ? turned : item))),
      );
      return true;
    },
    act(stale, action, richText) {
      const blocks = (page()?.blocks ?? []) as Block[];
      const at = locate(blocks, stale.id);
      if (!at) return false;
      const block = at.list[at.index];
      const parentId = parentOf(block);
      const previous = at.list[at.index - 1];
      const next = at.list[at.index + 1];
      const moved = withText(block, richText);
      if (action === "check") {
        if (block.type === "to_do") this.check(block);
      } else if (action === "previous" || action === "next") {
        const order = flat(blocks).filter((item) => (EDITABLE_TYPES as readonly string[]).includes(item.type));
        const other = order[order.findIndex((item) => item.id === block.id) + (action === "next" ? 1 : -1)];
        if (other) setEditing(other.id);
      } else if (!parentId) {
        return false;
      } else if (action === "duplicate") {
        const copy = {
          ...moved,
          id: localId(),
          has_children: false,
          children: undefined,
        };
        setBlocks((list) => putAfter(list, block.id, copy));
        setEditing(copy.id);
        create(copy, { parentId, afterId: block.id });
      } else if (action === "up") {
        // The block above goes below this one instead: Notion's API cannot put a block first in a list.
        if (!previous || !movable(previous)) return false;
        remake(previous, { parentId, afterId: block.id }, (list) => putAfter(drop(list, previous.id), block.id, previous));
        return true;
      } else if (action === "down") {
        if (!next || !movable(block)) return false;
        remake(moved, { parentId, afterId: next.id }, (list) => putAfter(drop(list, block.id), next.id, moved));
        return true;
      } else if (action === "indent") {
        if (!previous || !NESTABLE.includes(previous.type) || !movable(block)) return false;
        const inside = {
          ...moved,
          parent: { type: "block_id", block_id: previous.id },
        };
        remake(inside, { parentId: previous.id }, (list) => putInside(drop(list, block.id), previous.id, inside));
        return true;
      } else if (action === "outdent") {
        const parent = at.parent;
        const grand = parent && parentOf(parent);
        if (!parent || !grand || !NESTABLE.includes(parent.type) || !movable(block)) return false;
        const outside = { ...moved, parent: parent.parent };
        remake(outside, { parentId: grand, afterId: parent.id }, (list) => putAfter(drop(list, block.id), parent.id, outside));
        return true;
      }
      return false;
    },
    epoch,
    editing,
    start: setEditing,
    stop: (blockId) => setEditing((current) => (current === blockId ? null : current)),
    save(block, richText) {
      const value = block[block.type];
      replace({ ...block, [block.type]: { ...value, rich_text: richText } });
      send({
        op: "text",
        blockId: block.id,
        type: block.type as EditableType,
        richText: richTextRequest(richText),
      });
    },
    check(block) {
      const checked = !block.to_do?.checked;
      replace({ ...block, to_do: { ...block.to_do, checked } });
      send({ op: "check", blockId: block.id, checked });
    },
    insertAfter(block, chosen) {
      const parentId = parentOf(block);
      if (!parentId) return;
      const type = chosen ?? (LIST_TYPES.includes(block.type) ? (block.type as EditableType) : "paragraph");
      const added: Block = {
        id: localId(),
        type,
        [type]: { rich_text: [] },
        parent: block.parent,
        has_children: false,
      };
      setBlocks((blocks) => putAfter(blocks, block.id, added));
      setEditing(added.id);
      create(added, { parentId, afterId: block.id });
    },
    remove(block) {
      let previous: string | null = null;
      setBlocks((blocks) =>
        editSiblings(blocks, block.id, (list, i) => {
          previous = list[i - 1]?.id ?? null;
          return list.filter((_, j) => j !== i);
        }),
      );
      setEditing(previous);
      send({ op: "delete", blockId: block.id });
    },
    rename(richText) {
      const title = plainText(richText);
      client.setQueryData<NotionPage>(key, (data) => data && { ...data, title, titleRich: richText });
      // The daemon renamed its tree node; the Explorer and breadcrumbs reload it.
      send(
        { op: "title", title, richText: richTextRequest(richText) },
        () => void client.invalidateQueries({ queryKey: ["notion", "index"] }),
      );
    },
  };
}
