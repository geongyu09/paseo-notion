/** Block types whose text can be edited in place. */
export const EDITABLE_TYPES = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
] as const;
export type EditableType = (typeof EDITABLE_TYPES)[number];

/** Enter on these makes another item of the same kind, as in Notion; every other block gets a paragraph. */
export const LIST_TYPES: readonly string[] = ["bulleted_list_item", "numbered_list_item", "to_do"];

/** Cmd+Option+0 to 8 turn a block into these, in Notion's order. */
export const TURN_INTO: readonly EditableType[] = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "to_do",
  "bulleted_list_item",
  "numbered_list_item",
  "toggle",
  "code",
];

/** The `/` menu; the client translates each label. `words` hold the Korean and English block names, so a command matches in either app language. */
export const SLASH_ITEMS: readonly { type: EditableType; words: string }[] = [
  { type: "paragraph", words: "텍스트 text paragraph 문단" },
  { type: "heading_1", words: "제목 1 h1 heading heading 1" },
  { type: "heading_2", words: "제목 2 h2 heading heading 2" },
  { type: "heading_3", words: "제목 3 h3 heading heading 3" },
  { type: "heading_4", words: "제목 4 h4 heading heading 4" },
  { type: "bulleted_list_item", words: "글머리 기호 목록 bullet list 불릿 bulleted list" },
  { type: "numbered_list_item", words: "번호 매기기 목록 number list ordered numbered list" },
  { type: "to_do", words: "할 일 목록 todo checkbox 체크박스 to-do list" },
  { type: "toggle", words: "토글 toggle list" },
  { type: "quote", words: "인용 quote" },
  { type: "callout", words: "콜아웃 callout" },
  { type: "code", words: "코드 code" },
];

/** The `/` command being typed at the end of `text`: where it starts and the menu items it matches. */
export function slashCommand(text: string) {
  const match = /(?:^|\s)\/(\S*)$/.exec(text);
  if (!match) return null;
  const query = match[1].toLowerCase();
  const items = SLASH_ITEMS.filter((item) => item.words.toLowerCase().replace(/ /g, "").includes(query));
  return { start: match.index, items };
}

/** Blocks that can hold an indented block. */
export const NESTABLE: readonly string[] = ["paragraph", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout"];

const PREFIX = /^(?:(#{1,4}|[-*+]|\d+\.|\[\]|>|") |(```))/;

/** Notion's Markdown shortcuts: text that starts with `# `, `- `, `1. `, `[] `, `> `, `" `, or ``` names a block type. */
export function blockPrefix(text: string): { type: EditableType; rest: string } | null {
  const match = PREFIX.exec(text);
  if (!match) return null;
  const sign = match[1] ?? match[2];
  const type: EditableType =
    sign[0] === "#"
      ? (`heading_${sign.length}` as EditableType)
      : sign === "[]"
        ? "to_do"
        : sign === ">"
          ? "toggle"
          : sign === '"'
            ? "quote"
            : sign === "```"
              ? "code"
              : /\d/.test(sign)
                ? "numbered_list_item"
                : "bulleted_list_item";
  return { type, rest: text.slice(match[0].length) };
}

export interface Annotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

/** A Notion rich text item as the API returns it; edits keep this shape so the page can render them. */
export interface RichItem {
  type: string;
  plain_text: string;
  href?: string | null;
  annotations?: Annotations;
  text?: { content: string; link: { url: string } | null };
  mention?: Record<string, any> & { type: string };
  equation?: { expression: string };
}

const PLAIN: Annotations = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
// Notion rejects text objects longer than 2000 characters.
const MAX_TEXT = 2000;

export const plainText = (items: readonly RichItem[] | undefined) => (items ?? []).map((item) => item.plain_text).join("");

/**
 * Applies a plain-text edit to rich text. Only the changed span is rewritten, so the formatting,
 * links, and mentions around it are kept; typed text takes the formatting of the text before it.
 * The span runs from the first to the last changed character, so two edits far apart rewrite
 * everything between them; text with formatting worth keeping is edited as Markdown instead.
 * shortcut: a character typed just before an identical one counts as typed after it, so at a
 * formatting boundary it takes the next span's formatting; pass the caret position to fix that.
 */
export function editRichText(items: readonly RichItem[], next: string): RichItem[] {
  const old = plainText(items);
  if (old === next) return [...items];
  const shortest = Math.min(old.length, next.length);
  let start = 0;
  while (start < shortest && old[start] === next[start]) start++;
  let tail = 0;
  while (tail < shortest - start && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const cutEnd = old.length - tail;
  const inserted = next.slice(start, next.length - tail);

  const out: RichItem[] = [];
  const pushText = (from: RichItem | undefined, content: string) => {
    for (let i = 0; i < content.length; i += MAX_TEXT) out.push(textItem(from, content.slice(i, i + MAX_TEXT)));
  };
  if (!items.length) pushText(undefined, inserted);

  let offset = 0;
  items.forEach((item, index) => {
    const from = offset;
    const to = (offset += item.plain_text.length);
    const target = inserted !== "" && (start === 0 ? index === 0 : from < start && start <= to);
    const cut = start < cutEnd && from < cutEnd && to > start;
    if (!target && !cut) return void out.push(item);
    const left = item.plain_text.slice(0, Math.max(0, start - from));
    const right = item.plain_text.slice(Math.max(0, cutEnd - from));
    const typed = target ? inserted : "";
    if (item.type === "text" || cut || (from < start && start < to)) return pushText(item, left + typed + right);
    // Typing beside an untouched mention or equation adds plain text next to it.
    if (start === from) pushText(undefined, typed);
    out.push(item);
    if (start !== from) pushText(undefined, typed);
  });
  return out;
}

function textItem(from: RichItem | undefined, content: string): RichItem {
  if (from?.type === "text" && from.text) return { ...from, text: { ...from.text, content }, plain_text: content };
  return { type: "text", text: { content, link: null }, annotations: from?.annotations ?? PLAIN, plain_text: content, href: null };
}

/** The request form of rich text: read-only fields such as `plain_text` and user names are dropped. */
export function richTextRequest(items: readonly RichItem[]) {
  return items.map((item) => {
    const annotations = item.annotations ?? PLAIN;
    if (item.type === "mention" && item.mention) {
      const value = item.mention[item.mention.type];
      const ref = value && typeof value === "object" && "id" in value ? { id: value.id } : value;
      return { type: "mention" as const, mention: { type: item.mention.type, [item.mention.type]: ref }, annotations };
    }
    if (item.type === "equation" && item.equation) {
      return { type: "equation" as const, equation: { expression: item.equation.expression }, annotations };
    }
    const link = item.text?.link?.url ? { url: item.text.link.url } : null;
    return { type: "text" as const, text: { content: item.text?.content ?? item.plain_text, link }, annotations };
  });
}

type Tree = { id: string; children?: Tree[] };

/** Rewrites the sibling list that holds block `id`, copying only the path down to it. */
export function editSiblings<T extends Tree>(blocks: T[], id: string, edit: (list: T[], index: number) => T[]): T[] {
  const index = blocks.findIndex((block) => block.id === id);
  if (index >= 0) return edit(blocks, index);
  let changed = false;
  const next = blocks.map((block) => {
    if (!block.children?.length) return block;
    const children = editSiblings(block.children as T[], id, edit);
    if (children === block.children) return block;
    changed = true;
    return { ...block, children };
  });
  return changed ? next : blocks;
}

/** Where block `id` sits: its sibling list, its index there, and the block that holds the list. */
export function locate<T extends Tree>(blocks: readonly T[], id: string, parent?: T): { list: readonly T[]; index: number; parent?: T } | undefined {
  const index = blocks.findIndex((block) => block.id === id);
  if (index >= 0) return { list: blocks, index, parent };
  for (const block of blocks) {
    const found = block.children && locate(block.children as T[], id, block);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Markdown shown while editing, so formatting stays visible and editable in a plain input.

const MARKS = [
  ["bold", "**"],
  ["italic", "*"],
  ["strikethrough", "~~"],
] as const;
type Mark = (typeof MARKS)[number][0];
// Only what the parser below would read as syntax: `~` is common in Korean text and `[` in titles.
const escapeMarkdown = (text: string) => text.replace(/[\\*`]|~(?=~)|\[(?=[^\]]*\]\()/g, "\\$&");
const LINK = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/;
const TOKEN = /^@\[([^\]]*)\]/;

/**
 * Rich text as Markdown: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`, and
 * `@[name]` for a mention or equation. Underline and color have no syntax; `fromMarkdown` restores them.
 * shortcut: inline code that contains a backtick comes back split at it; use longer fences if that matters.
 */
export function toMarkdown(items: readonly RichItem[]): string {
  const open: Record<Mark, boolean> = { bold: false, italic: false, strikethrough: false };
  let out = "";
  const mark = (annotations: Partial<Annotations>) => {
    for (const [name, sign] of MARKS) {
      if (!!annotations[name] === open[name]) continue;
      open[name] = !open[name];
      out += sign;
    }
  };
  for (const item of items) {
    const annotations = item.annotations ?? PLAIN;
    const url = item.text?.link?.url;
    const wrap = (body: string) => (url ? `[${body}](${url})` : body);
    if (item.type !== "text" || annotations.code) {
      mark(annotations);
      out += wrap(item.type !== "text" ? `@[${item.plain_text}]` : `\`${item.plain_text}\``);
      continue;
    }
    // Markers hug the words: one beside a space reads as a plain character, here and in Markdown.
    const [, lead, core, trail] = /^(\s*)([^]*?)(\s*)$/.exec(item.plain_text)!;
    // Closes what this item ends before its leading space; a space-only item ends everything.
    mark(core ? Object.fromEntries(MARKS.map(([name]) => [name, open[name] && annotations[name]])) : {});
    out += lead;
    if (core) {
      mark(annotations);
      out += wrap(escapeMarkdown(core));
    }
    if (trail) {
      mark({});
      out += trail;
    }
  }
  mark({});
  return out;
}

interface Segment {
  text: string;
  marks: Record<Mark, boolean> & { code: boolean };
  url: string | null;
  /** The mention or equation an `@[name]` stood for. */
  source?: RichItem;
}

/**
 * Reads Markdown written by `toMarkdown` and edited by hand back into rich text. Unmatched markers
 * stay literal. `old` supplies the mentions that `@[name]` refers to, and the underline and color
 * of the text that was not retyped.
 */
export function fromMarkdown(markdown: string, old: readonly RichItem[]): RichItem[] {
  const segments: Segment[] = [];
  const marks: Record<Mark, boolean> = { bold: false, italic: false, strikethrough: false };
  const push = (text: string, url: string | null, code = false, source?: RichItem) => {
    const last = segments[segments.length - 1];
    const same = last && !last.source && !source && last.url === url && last.marks.code === code && MARKS.every(([name]) => last.marks[name] === marks[name]);
    if (same) last.text += text;
    else if (text) segments.push({ text, marks: { ...marks, code }, url, source });
  };
  const scan = (src: string, url: string | null) => {
    for (let i = 0; i < src.length; ) {
      const rest = src.slice(i);
      if (src[i] === "\\" && i + 1 < src.length) {
        push(src[i + 1], url);
        i += 2;
        continue;
      }
      if (src[i] === "`") {
        const end = src.indexOf("`", i + 1);
        if (end > i + 1) {
          push(src.slice(i + 1, end), url, true);
          i = end + 1;
          continue;
        }
      }
      // A marker closes whatever it opened; it opens only before a word and with a closing marker ahead.
      const opens = (sign: string) => /\S/.test(rest[sign.length] ?? "") && rest.indexOf(sign, sign.length) >= 0;
      const sign =
        MARKS.find(([name, s]) => s !== "*" && rest.startsWith(s) && (marks[name] || opens(s))) ??
        // A `**` that is not bold is two plain stars, not an empty italic.
        (src[i] === "*" && !rest.startsWith("**") && (marks.italic || opens("*")) ? MARKS[1] : undefined);
      if (sign) {
        marks[sign[0]] = !marks[sign[0]];
        i += sign[1].length;
        continue;
      }
      const link = url === null ? LINK.exec(rest) : null;
      if (link) {
        scan(link[1], link[2]);
        i += link[0].length;
        continue;
      }
      const token = TOKEN.exec(rest);
      const source = token && old.find((item) => item.type !== "text" && item.plain_text === token[1]);
      if (token && source) {
        push(source.plain_text, url, false, source);
        i += token[0].length;
        continue;
      }
      push(src[i], url);
      i++;
    }
  };
  scan(markdown, null);

  // Underline and color come from the old character at the same place; retyped text takes the ones before it.
  const extras = old.flatMap((item) => {
    const { underline, color } = item.annotations ?? PLAIN;
    return Array.from(item.plain_text, () => ({ underline, color }));
  });
  const oldText = plainText(old);
  const newText = segments.map((segment) => segment.text).join("");
  const shortest = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < shortest && oldText[start] === newText[start]) start++;
  let tail = 0;
  while (tail < shortest - start && oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]) tail++;
  const extraAt = (i: number) =>
    extras[i < start ? i : i >= newText.length - tail ? i - newText.length + oldText.length : Math.max(0, start - 1)] ?? PLAIN;

  const out: RichItem[] = [];
  let offset = 0;
  for (const segment of segments) {
    const from = offset;
    offset += segment.text.length;
    if (segment.source) {
      const { underline, color } = segment.source.annotations ?? PLAIN;
      out.push({ ...segment.source, annotations: { ...segment.marks, underline, color } });
      continue;
    }
    for (let i = 0; i < segment.text.length; ) {
      const extra = extraAt(from + i);
      let end = i + 1;
      while (end < segment.text.length && end - i < MAX_TEXT && extraAt(from + end).underline === extra.underline && extraAt(from + end).color === extra.color) end++;
      const content = segment.text.slice(i, end);
      out.push({
        type: "text",
        text: { content, link: segment.url ? { url: segment.url } : null },
        annotations: { ...segment.marks, underline: extra.underline, color: extra.color },
        plain_text: content,
        href: segment.url,
      });
      i = end;
    }
  }
  return out;
}
