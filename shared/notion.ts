import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { EDITABLE_TYPES } from "./edit";

export const connection = defineSettings({
  id: "connection",
  scope: "host",
  version: 2,
  // One internal integration token per Notion workspace; the first opens when none was picked.
  schema: z.object({ tokens: z.array(z.string()).default([]) }),
  migrate: (values) => {
    const token = String((values as { token?: unknown }).token ?? "").trim();
    return { tokens: token ? [token] : [] };
  },
});

/** A workspace's token hash; null, or a hash whose token was removed, means the first token. */
const space = z.string().nullable();

export const workspacesRpc = defineRpc({
  name: "notion.workspaces",
  input: z.object({}),
  /** `name` is null when Notion has none; `error` is the raw message when the token could not be read. */
  output: z.array(z.object({ id: z.string(), name: z.string().nullable(), error: z.string().optional() })),
});

/** A property value; the client words `checked`, `links`, and `items` in the app language. */
const value = z.object({
  text: z.string(),
  /** Checkbox properties. */
  checked: z.boolean().optional(),
  /** Relations: how many pages they link, when any. */
  links: z.number().optional(),
  /** Rollups that collect an array: how many items it holds, when any. */
  items: z.number().optional(),
});
export type PropertyValue = z.infer<typeof value>;

const node = z.object({
  id: z.string(),
  kind: z.enum(["page", "database"]),
  title: z.string(),
  /** Emoji icons only; uploaded icons use signed URLs that expire within an hour. */
  icon: z.string().nullable(),
  parentId: z.string().nullable(),
  /** Database nodes: the database ID that child_database blocks carry. */
  databaseId: z.string().nullable(),
  lastEdited: z.string(),
  url: z.string(),
});
export type NotionNode = z.infer<typeof node>;

export const indexRpc = defineRpc({
  name: "notion.index",
  input: z.object({ space, refresh: z.boolean() }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      space: z.string(),
      nodes: z.array(node),
      builtAt: z.string(),
      refreshing: z.boolean(),
    }),
    z.object({ status: z.literal("no-token") }),
  ]),
});

export const pageRpc = defineRpc({
  name: "notion.page",
  input: z.object({ space, id: z.string() }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    /** The title as rich text, so editing it keeps its mentions and formatting. */
    titleRich: z.array(z.unknown()),
    icon: z.string().nullable(),
    url: z.string(),
    properties: z.array(value.extend({ name: z.string() })),
    /** Notion block objects; blocks with children carry them in `children`. */
    blocks: z.array(z.unknown()),
  }),
});
export type NotionPage = z.infer<typeof pageRpc.output>;

const cell = value.extend({
  /** Select, status, and multi-select options with Notion's color names. */
  chips: z.array(z.object({ name: z.string(), color: z.string() })).optional(),
});
export type DatabaseCell = z.infer<typeof cell>;

export const databaseRpc = defineRpc({
  name: "notion.database",
  /** `id` is the data source ID the tree keys databases by; `cursor` continues an earlier answer. */
  input: z.object({ space, id: z.string().regex(/^[0-9a-f-]{32,36}$/i), cursor: z.string().nullable() }),
  output: z.object({
    /** The title column first. */
    columns: z.array(z.object({ name: z.string(), type: z.string() })),
    /** Newest edit first; `cells` line up with `columns`. */
    rows: z.array(z.object({ id: z.string(), icon: z.string().nullable(), cells: z.array(cell) })),
    nextCursor: z.string().nullable(),
  }),
});
export type NotionDatabase = z.infer<typeof databaseRpc.output>;

// Notion IDs, dashed or not; checked because they go into request paths.
const notionId = z.string().regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i);
const annotations = z.object({
  bold: z.boolean(),
  italic: z.boolean(),
  strikethrough: z.boolean(),
  underline: z.boolean(),
  code: z.boolean(),
  color: z.string(),
});
/** Rich text in Notion's request form, as `richTextRequest` builds it. */
const richText = z.array(
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("text"),
      text: z.object({ content: z.string().max(2000), link: z.object({ url: z.string() }).nullable() }),
      annotations,
    }),
    z.object({ type: z.literal("mention"), mention: z.record(z.string(), z.unknown()), annotations }),
    z.object({ type: z.literal("equation"), equation: z.object({ expression: z.string() }), annotations }),
  ]),
);
const editable = z.enum(EDITABLE_TYPES);

const blockChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("text"), blockId: notionId, type: editable, richText }),
  z.object({ op: z.literal("check"), blockId: notionId, checked: z.boolean() }),
  // Adds a block at the end of `parentId`, or after `afterId`. With `removeId` it stands in for that
  // block, which is how a block moves or changes type: Notion's API can do neither in place.
  z.object({
    op: z.literal("insert"),
    parentId: notionId,
    afterId: notionId.optional(),
    type: editable,
    richText,
    removeId: notionId.optional(),
    props: z.object({ color: z.string(), checked: z.boolean(), language: z.string(), emoji: z.string() }).partial().optional(),
  }),
  z.object({ op: z.literal("delete"), blockId: notionId }),
  z.object({ op: z.literal("title"), richText, title: z.string() }),
]);
export type BlockChange = z.infer<typeof blockChange>;

export const editRpc = defineRpc({
  name: "notion.edit",
  input: z.object({ space, pageId: notionId, change: blockChange }),
  /** The block as Notion saved it; null for deletes and title changes. */
  output: z.object({ block: z.unknown().nullable() }),
});
