import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BlockChange, DatabaseCell, NotionDatabase, NotionNode, NotionPage, PropertyValue } from "../shared/notion";
import { linkParents } from "../shared/tree";

// Notion API objects are large and loosely typed; this module reads only the fields it names.
type Json = any;

const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const CACHE_DIR = join(homedir(), ".cache", "paseo-notion");
const cacheFile = (tokenHash: string) => join(CACHE_DIR, `index-${tokenHash}.json`);
const INDEX_STALE_MS = 10 * 60_000;
// File and image URLs in block payloads are signed for one hour.
const PAGE_CACHE_MS = 45 * 60_000;
const PAGE_CACHE_LIMIT = 50;
// Notion allows about three requests per second on average with short bursts.
const MAX_CONCURRENT = 6;

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

async function notion(token: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<Json> {
  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": VERSION,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429 && attempt < 5) {
        const seconds = Number(response.headers.get("retry-after")) || 1;
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        continue;
      }
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Notion API ${response.status}: ${json.message ?? response.statusText}`);
      }
      return json;
    }
  });
}

const plain = (text: Json[] | undefined) => (text ?? []).map((part) => part.plain_text).join("");

function titleRichOf(item: Json): Json[] {
  if (item.object !== "page") return item.title ?? [];
  const title = Object.values(item.properties ?? {}).find((property: Json) => property.type === "title") as Json;
  return title?.title ?? [];
}

const titleOf = (item: Json) => plain(titleRichOf(item));

const emojiOf = (item: Json): string | null => (item.icon?.type === "emoji" ? item.icon.emoji : null);

// ---------------------------------------------------------------------------
// Page tree

interface IndexFile {
  tokenHash: string;
  builtAt: string;
  nodes: NotionNode[];
  /** Block ID to the page or database that contains it; blocks rarely move. */
  blockParents: Record<string, string | null>;
}

// Keyed by token hash, one entry per workspace.
const indexes = new Map<string, IndexFile>();
const builds = new Map<string, Promise<IndexFile>>();
const names = new Map<string, string | null>();

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

/** The workspace a token belongs to, named as Notion's workspace switcher names it. */
export async function describeWorkspace(token: string) {
  const id = hashToken(token);
  if (!names.has(id)) {
    try {
      const me = await notion(token, "/users/me");
      names.set(id, me.bot?.workspace_name || me.name || null);
    } catch (error) {
      // Not cached, so a fixed network or a replaced token shows its name next time.
      return { id, name: null, error: (error as Error).message };
    }
  }
  return { id, name: names.get(id) ?? null };
}

async function loadCache(tokenHash: string): Promise<IndexFile | null> {
  try {
    const cached = JSON.parse(await readFile(cacheFile(tokenHash), "utf8")) as IndexFile;
    return cached.tokenHash === tokenHash ? cached : null;
  } catch {
    return null;
  }
}

async function buildIndex(token: string, knownBlockParents: Record<string, string | null>): Promise<IndexFile> {
  const results: Json[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion(token, "/search", { page_size: 100, start_cursor: cursor });
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);

  const blockParents = { ...knownBlockParents };
  const resolving = new Map<string, Promise<string | null>>();
  const parentOf = (parent: Json): string | null | Promise<string | null> => {
    switch (parent?.type) {
      case "page_id":
        return parent.page_id;
      case "data_source_id":
        return parent.data_source_id;
      case "database_id":
        return parent.database_id;
      case "block_id":
        return blockParent(parent.block_id);
      default:
        return null;
    }
  };
  const blockParent = (id: string): string | null | Promise<string | null> => {
    if (id in blockParents) return blockParents[id];
    let pending = resolving.get(id);
    if (!pending) {
      pending = notion(token, `/blocks/${id}`)
        .then((block) => parentOf(block.parent))
        .then((parent) => (blockParents[id] = parent))
        // An unreadable block leaves its page at the root for this build only.
        .catch(() => null);
      resolving.set(id, pending);
    }
    return pending;
  };

  const nodes = await Promise.all(
    results
      .filter((item) => !item.in_trash && !item.archived)
      .map(
        async (item): Promise<NotionNode> => ({
          id: item.id,
          kind: item.object === "page" ? "page" : "database",
          title: titleOf(item),
          icon: emojiOf(item),
          parentId: await parentOf(item.object === "page" ? item.parent : item.database_parent),
          databaseId: item.object === "data_source" ? (item.parent?.database_id ?? null) : null,
          lastEdited: item.last_edited_time,
          url: item.url,
        }),
      ),
  );
  return { tokenHash: hashToken(token), builtAt: new Date().toISOString(), nodes: linkParents(nodes), blockParents };
}

function startBuild(token: string, fresh: boolean): Promise<IndexFile> {
  const tokenHash = hashToken(token);
  let build = builds.get(tokenHash);
  if (!build) {
    build = buildIndex(token, fresh ? {} : (indexes.get(tokenHash)?.blockParents ?? {}))
      .then(async (next) => {
        indexes.set(tokenHash, next);
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheFile(tokenHash), JSON.stringify(next), { mode: 0o600 });
        return next;
      })
      .finally(() => builds.delete(tokenHash));
    builds.set(tokenHash, build);
  }
  return build;
}

/** Deletes the trees of workspaces whose token was removed, so their page titles leave the disk too. */
export async function forgetOtherWorkspaces(tokens: string[]) {
  const keep = new Set(tokens.map(hashToken));
  for (const tokenHash of indexes.keys()) if (!keep.has(tokenHash)) indexes.delete(tokenHash);
  // shortcut: a build still running for a removed token writes its file afterwards; the next settings change or plugin start deletes it.
  const files = await readdir(CACHE_DIR).catch(() => [] as string[]);
  const stale = files.filter((file) => /^index(-[0-9a-f]{16})?\.json$/.test(file) && !keep.has(file.slice(6, 22)));
  await Promise.all(stale.map((file) => rm(join(CACHE_DIR, file), { force: true })));
}

/** Answers from the cached tree and rebuilds it in the background once it is stale. */
export async function getIndex(token: string, refresh: boolean) {
  const tokenHash = hashToken(token);
  const index = indexes.get(tokenHash) ?? (await loadCache(tokenHash));
  if (index) indexes.set(tokenHash, index);
  if (!index || refresh) {
    const built = await startBuild(token, refresh);
    return { nodes: built.nodes, builtAt: built.builtAt, refreshing: false };
  }
  if (Date.now() - Date.parse(index.builtAt) > INDEX_STALE_MS) {
    startBuild(token, false).catch((error) => console.error("Background Notion index refresh failed", error));
  }
  return { nodes: index.nodes, builtAt: index.builtAt, refreshing: builds.has(tokenHash) };
}

// ---------------------------------------------------------------------------
// Pages

const pages = new Map<string, { lastEdited: string; at: number; value: NotionPage }>();

async function children(token: string, id: string): Promise<Json[]> {
  const blocks: Json[] = [];
  let cursor: string | undefined;
  do {
    const query = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const page = await notion(token, `/blocks/${id}/children${query}`);
    blocks.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  await Promise.all(
    blocks
      .filter((block) => block.has_children && block.type !== "child_page" && block.type !== "child_database")
      .map(async (block) => {
        block.children = await children(token, block.id);
      }),
  );
  return blocks;
}

const formatDate = (value: string) => (value.length > 10 ? value.slice(0, 16).replace("T", " ") : value);

function propertyText(property: Json): string {
  const value = property[property.type];
  switch (property.type) {
    case "rich_text":
      return plain(value);
    case "number":
      return value == null ? "" : String(value);
    case "select":
    case "status":
      return value?.name ?? "";
    case "multi_select":
      return value.map((option: Json) => option.name).join(", ");
    case "date":
      return value ? formatDate(value.start) + (value.end ? ` → ${formatDate(value.end)}` : "") : "";
    case "url":
    case "email":
    case "phone_number":
      return value ?? "";
    case "people":
      return value.map((person: Json) => person.name).filter(Boolean).join(", ");
    case "files":
      return value.map((file: Json) => file.name).join(", ");
    case "created_time":
    case "last_edited_time":
      return formatDate(value);
    case "created_by":
    case "last_edited_by":
      return value?.name ?? "";
    case "formula":
      return value.type === "date" ? (value.date ? formatDate(value.date.start) : "") : String(value[value.type] ?? "");
    case "rollup":
      if (value.type === "date") return value.date ? formatDate(value.date.start) : "";
      return String(value[value.type] ?? "");
    case "unique_id":
      return value.number == null ? "" : `${value.prefix ? `${value.prefix}-` : ""}${value.number}`;
    default:
      return "";
  }
}

/** A property's value; checkboxes and counts stay data so the client words them in the app language. */
function propertyValue(property: Json): PropertyValue {
  const value = property[property.type];
  if (property.type === "checkbox") return { text: "", checked: !!value };
  if (property.type === "relation") return value.length ? { text: "", links: value.length } : { text: "" };
  if (property.type === "rollup" && value.type === "array") return value.array.length ? { text: "", items: value.array.length } : { text: "" };
  return { text: propertyText(property) };
}

export async function getPage(token: string, id: string): Promise<NotionPage> {
  const page = await notion(token, `/pages/${id}`);
  const cached = pages.get(page.id);
  if (cached && cached.lastEdited === page.last_edited_time && Date.now() - cached.at < PAGE_CACHE_MS) {
    return cached.value;
  }
  const value: NotionPage = {
    id: page.id,
    title: titleOf(page),
    titleRich: titleRichOf(page),
    icon: emojiOf(page),
    url: page.url,
    properties: Object.entries(page.properties ?? {})
      .filter(([, property]: [string, Json]) => property.type !== "title")
      .map(([name, property]) => ({ name, ...propertyValue(property) }))
      .filter((property) => property.text !== "" || property.checked !== undefined || property.links || property.items),
    blocks: await children(token, page.id),
  };
  pages.delete(page.id);
  pages.set(page.id, { lastEdited: page.last_edited_time, at: Date.now(), value });
  if (pages.size > PAGE_CACHE_LIMIT) pages.delete(pages.keys().next().value!);
  return value;
}

function cellOf(property: Json): DatabaseCell {
  const value = property?.[property.type];
  switch (property?.type) {
    case undefined:
      return { text: "" };
    case "title":
      return { text: plain(value) };
    case "select":
    case "status":
      return { text: value?.name ?? "", chips: value ? [{ name: value.name, color: value.color }] : [] };
    case "multi_select":
      return { text: propertyText(property), chips: value.map((option: Json) => ({ name: option.name, color: option.color })) };
    default:
      return propertyValue(property);
  }
}

/** One page of a database's rows as a table. The public API has no views, so columns follow the schema. */
export async function getDatabase(token: string, id: string, cursor: string | null): Promise<NotionDatabase> {
  const [source, result] = await Promise.all([
    notion(token, `/data_sources/${id}`),
    notion(token, `/data_sources/${id}/query`, {
      page_size: 50,
      start_cursor: cursor ?? undefined,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    }),
  ]);
  const columns = Object.entries(source.properties ?? {})
    .map(([name, property]: [string, Json]) => ({ name, type: property.type as string }))
    .sort((a, b) => Number(b.type === "title") - Number(a.type === "title"));
  return {
    columns,
    rows: result.results.map((page: Json) => ({
      id: page.id,
      icon: emojiOf(page),
      cells: columns.map((column) => cellOf(page.properties?.[column.name])),
    })),
    nextCursor: result.has_more ? result.next_cursor : null,
  };
}

/** Saves one edit; the page's cached copy is dropped because Notion rounds edit times to the minute. */
export async function editPage(token: string, pageId: string, change: BlockChange): Promise<{ block: Json | null }> {
  pages.delete(pageId);
  switch (change.op) {
    case "text":
      return { block: await notion(token, `/blocks/${change.blockId}`, { [change.type]: { rich_text: change.richText } }, "PATCH") };
    case "check":
      return { block: await notion(token, `/blocks/${change.blockId}`, { to_do: { checked: change.checked } }, "PATCH") };
    case "insert": {
      const { type, props = {} } = change;
      const value =
        type === "code"
          ? { rich_text: change.richText, language: props.language ?? "plain text" }
          : {
              rich_text: change.richText,
              color: props.color,
              ...(type === "to_do" ? { checked: !!props.checked } : {}),
              ...(type === "callout" && props.emoji ? { icon: { type: "emoji", emoji: props.emoji } } : {}),
            };
      const created = await notion(
        token,
        `/blocks/${change.parentId}/children`,
        { children: [{ object: "block", type, [type]: value }], after: change.afterId },
        "PATCH",
      );
      // Created first, so a failure here leaves a duplicate instead of losing the text.
      if (change.removeId) await notion(token, `/blocks/${change.removeId}`, undefined, "DELETE");
      return { block: created.results[0] };
    }
    case "delete":
      await notion(token, `/blocks/${change.blockId}`, undefined, "DELETE");
      return { block: null };
    case "title": {
      // The title property's ID is always "title", whatever a database names it.
      await notion(token, `/pages/${pageId}`, { properties: { title: { title: change.richText } } }, "PATCH");
      const node = indexes.get(hashToken(token))?.nodes.find((item) => item.id === pageId);
      if (node) node.title = change.title;
      return { block: null };
    }
  }
}
