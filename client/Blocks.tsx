import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useTranslation } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, type StyleProp, StyleSheet, Text, TextInput, type TextStyle, View, type ViewStyle } from "react-native";
import {
  blockPrefix,
  type EditableType,
  slashCommand,
  editRichText,
  fromMarkdown,
  LIST_TYPES,
  plainText,
  type RichItem,
  toMarkdown,
  TURN_INTO,
} from "../shared/edit";
import type { NotionNode } from "../shared/notion";
import { listMarker, notionIdFromUrl } from "../shared/tree";
import type { BlockAction, BlockEditor } from "./editor";
import { MONO, notionColor, SANS } from "./look";
import { messages } from "./messages";
import { HoverPressable, NodeIcon } from "./parts";
import { hasTextSelection } from "./web";

// Notion block JSON, read field by field below.
export type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: Block[];
} & Record<string, any>;

interface RichTextItem {
  type: "text" | "mention" | "equation";
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  mention?: { type: string; page?: { id: string }; database?: { id: string } };
}

export interface RenderContext {
  theme: PluginTheme;
  compact: boolean;
  /** Shows a page or database inside the panel. */
  open(id: string): void;
  node(id: string): NotionNode | undefined;
  /** Makes text blocks editable; without it the page is read-only. */
  editor?: BlockEditor;
}

// Notion's checkbox blue, which reads on light and dark surfaces.
const NOTION_BLUE = "#2383e2";

const Render = createContext<(RenderContext & { styles: ReturnType<typeof makeStyles> }) | null>(null);

function useRender() {
  const value = useContext(Render);
  if (!value) throw new Error("BlockList must render inside NotionBlocks.");
  return value;
}

// Sizes and spacing measured from notion.so: a block's text sits 8px inside it (6px block padding
// plus 2px line padding), so `paddingVertical: 2` goes on text and 6px or more on the block.
function makeStyles(theme: PluginTheme) {
  const c = theme.colors;
  const body: TextStyle = {
    color: c.foreground,
    fontFamily: SANS,
    fontSize: 16,
    lineHeight: 24,
  };
  return {
    body,
    line: { ...body, paddingVertical: 2 } satisfies TextStyle,
    muted: {
      color: c.foregroundMuted,
      fontFamily: SANS,
      fontSize: 14,
      lineHeight: 20,
    } satisfies TextStyle,
    // `top` is the block padding above the heading; every heading has 6px below.
    heading: {
      heading_1: {
        ...body,
        fontSize: 30,
        lineHeight: 39,
        fontWeight: "600",
        top: 30,
      },
      heading_2: {
        ...body,
        fontSize: 24,
        lineHeight: 31,
        fontWeight: "600",
        top: 26,
      },
      heading_3: {
        ...body,
        fontSize: 20,
        lineHeight: 26,
        fontWeight: "600",
        top: 22,
      },
      heading_4: {
        ...body,
        fontSize: 18,
        lineHeight: 23,
        fontWeight: "600",
        top: 18,
      },
    } satisfies Record<string, TextStyle & { top: number }>,
    nested: { paddingLeft: 24 },
  };
}

export function NotionBlocks({ blocks, ...context }: RenderContext & { blocks: readonly Block[] }) {
  const styles = useMemo(() => makeStyles(context.theme), [context.theme]);
  return (
    <Render.Provider value={{ ...context, styles }}>
      <BlockList blocks={blocks} />
    </Render.Provider>
  );
}

/** `depth` counts list nesting, which picks Notion's marker style. */
function BlockList({ blocks, depth = 0 }: { blocks: readonly Block[]; depth?: number }) {
  let number = 0;
  return (
    <>
      {blocks.map((block, i) => {
        number = block.type !== "numbered_list_item" ? 0 : blocks[i - 1]?.type === "numbered_list_item" ? number + 1 : 1;
        // Runs of list items and page links pack tightly, with block padding only at the ends.
        const run = {
          paddingTop: blocks[i - 1]?.type === block.type ? 2 : 6,
          paddingBottom: blocks[i + 1]?.type === block.type ? 2 : 6,
        };
        return <BlockView key={block.id} block={block} number={number} depth={depth} run={run} />;
      })}
    </>
  );
}

const plain = (text: RichTextItem[] | undefined) => (text ?? []).map((part) => part.plain_text).join("");

function fileUrl(value: any): string | undefined {
  return value?.type === "external" ? value.external?.url : value?.file?.url;
}

function Nested({ block }: { block: Block }) {
  const { styles } = useRender();
  if (!block.children?.length) return null;
  return (
    <View style={styles.nested}>
      <BlockList blocks={block.children} />
    </View>
  );
}

function BlockView({ block, number, depth, run }: { block: Block; number: number; depth: number; run: ViewStyle }) {
  const ctx = useRender();
  const { t } = useTranslation(messages);
  const { styles, theme } = ctx;
  const c = theme.colors;
  const value = block[block.type] ?? {};

  switch (block.type) {
    case "paragraph": {
      const tone = notionColor(value.color);
      return (
        <View style={{ paddingVertical: 6 }}>
          <BlockText block={block} style={[styles.line, { borderRadius: 4 }, tone]} />
          <Nested block={block} />
        </View>
      );
    }
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "heading_4": {
      const { top, ...heading } = styles.heading[block.type];
      const text = <BlockText block={block} style={[heading, { paddingVertical: 2 }, notionColor(value.color)]} />;
      const box = { paddingTop: top, paddingBottom: 6 };
      return value.is_toggleable ? (
        <Toggle header={text} block={block} lineHeight={heading.lineHeight} style={box} />
      ) : (
        <View style={box}>{text}</View>
      );
    }
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do": {
      const done = block.type === "to_do" && !!value.checked;
      const box =
        block.type === "to_do" ? (
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              borderWidth: 1.5,
              borderColor: done ? NOTION_BLUE : c.foreground,
              backgroundColor: done ? NOTION_BLUE : undefined,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {done ? <Icon name="Check" size={12} color="#ffffff" /> : null}
          </View>
        ) : null;
      const marker =
        box && ctx.editor ? (
          <Pressable
            accessibilityRole="checkbox"
            aria-checked={done}
            accessibilityLabel={plain(value.rich_text) || t("todo")}
            hitSlop={4}
            onPress={() => ctx.editor?.check(block)}
          >
            {box}
          </Pressable>
        ) : box ? (
          box
        ) : block.type === "bulleted_list_item" ? (
          <Text style={[styles.body, { fontSize: 24, lineHeight: 24 }]}>{listMarker(false, number, depth)}</Text>
        ) : (
          <Text style={styles.body}>{listMarker(true, number, depth)}</Text>
        );
      return (
        <View style={[{ flexDirection: "row" }, run]}>
          <View
            style={{
              minWidth: 24,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {marker}
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingLeft: 6 }}>
            <BlockText
              block={block}
              style={[
                styles.line,
                notionColor(value.color),
                done
                  ? {
                      color: c.foregroundMuted,
                      textDecorationLine: "line-through",
                    }
                  : null,
              ]}
            />
            {block.children?.length ? <BlockList blocks={block.children} depth={depth + 1} /> : null}
          </View>
        </View>
      );
    }
    case "toggle":
      return (
        <Toggle
          header={<BlockText block={block} style={[styles.line, notionColor(value.color)]} />}
          block={block}
          style={{ paddingVertical: 6 }}
        />
      );
    case "quote":
      return (
        <View style={{ paddingVertical: 8 }}>
          <View
            style={{
              borderLeftWidth: 3,
              borderLeftColor: c.foreground,
              paddingLeft: 22,
            }}
          >
            <BlockText block={block} style={[styles.body, notionColor(value.color)]} />
            {block.children?.length ? <BlockList blocks={block.children} /> : null}
          </View>
        </View>
      );
    case "callout": {
      const tinted = notionColor(value.color).backgroundColor;
      return (
        <View style={{ paddingVertical: 8 }}>
          <View
            style={{
              flexDirection: "row",
              padding: 12,
              borderRadius: 10,
              borderWidth: tinted ? 0 : 1,
              borderColor: c.border,
              backgroundColor: tinted,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                marginTop: 8,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 21, lineHeight: 24 }}>{value.icon?.type === "emoji" ? value.icon.emoji : "💡"}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
              <BlockText block={block} style={[styles.body, { paddingVertical: 8 }, tinted ? null : notionColor(value.color)]} />
              {block.children?.length ? <BlockList blocks={block.children} /> : null}
            </View>
          </View>
        </View>
      );
    }
    case "code":
      return <CodeBlock block={block} />;
    case "divider":
      return (
        <View style={{ paddingVertical: 6 }}>
          <View style={{ height: 1, backgroundColor: c.border }} />
        </View>
      );
    case "image": {
      const url = fileUrl(value);
      return url ? <ImageBlock url={url} caption={value.caption} /> : null;
    }
    case "video":
    case "audio":
    case "file":
    case "pdf": {
      const url = fileUrl(value);
      const icons: Record<string, string> = {
        video: "Film",
        audio: "Music",
        file: "Paperclip",
        pdf: "FileText",
      };
      const name = value.name || plain(value.caption) || decodeURIComponent(url?.split("?")[0].split("/").pop() ?? block.type);
      return url ? (
        <View style={run}>
          <LinkRow icon={icons[block.type]} label={name} onPress={() => void openExternalUrl(url)} />
        </View>
      ) : null;
    }
    case "bookmark":
    case "embed":
    case "link_preview":
      return value.url ? <LinkCard url={value.url} caption={value.caption} /> : null;
    case "child_page":
    case "child_database":
      return (
        <View style={run}>
          <LinkRow
            node={ctx.node(block.id)}
            fallbackIcon={block.type === "child_database" ? "Database" : "FileText"}
            label={value.title || t("untitled")}
            onPress={() => ctx.open(block.id)}
          />
        </View>
      );
    case "link_to_page": {
      const target = value.page_id ?? value.database_id ?? value.data_source_id;
      if (!target) return null;
      const node = ctx.node(target);
      return (
        <View style={run}>
          <LinkRow node={node} fallbackIcon="ArrowUpRight" label={node?.title || t("linkedPage")} onPress={() => ctx.open(target)} />
        </View>
      );
    }
    case "table":
      return <TableBlock block={block} />;
    case "column_list":
      return (
        <View
          style={{
            flexDirection: ctx.compact ? "column" : "row",
            gap: ctx.compact ? 0 : 46,
          }}
        >
          {(block.children ?? []).map((column) => (
            <View key={column.id} style={ctx.compact ? null : { flex: column.column?.width_ratio ?? 1, minWidth: 0 }}>
              <BlockList blocks={column.children ?? []} />
            </View>
          ))}
        </View>
      );
    case "column":
    case "synced_block":
    case "template":
      return <BlockList blocks={block.children ?? []} />;
    case "equation":
      return (
        <ScrollView horizontal style={{ paddingVertical: 8 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
          <Text selectable style={[styles.body, { fontFamily: MONO }]}>
            {value.expression}
          </Text>
        </ScrollView>
      );
    case "table_of_contents":
    case "breadcrumb":
      return null;
    default:
      return (
        <Text style={[styles.muted, { paddingVertical: 8 }]}>
          {block.type === "unsupported" ? t("unsupportedBlock") : t("hiddenBlock", { type: block.type })}
        </Text>
      );
  }
}

function RichText({ text, style, onPress }: { text: RichTextItem[] | undefined; style?: StyleProp<TextStyle>; onPress?(): void }) {
  const ctx = useRender();
  const items = text ?? [];
  // A space keeps empty paragraphs one line tall, as in Notion.
  if (!items.length) {
    return (
      <Text style={style} onPress={onPress}>
        {" "}
      </Text>
    );
  }
  return (
    <Text selectable style={style} onPress={onPress}>
      {items.map((item, i) => {
        const press = linkAction(item, ctx);
        return (
          <Text key={i} style={spanStyle(item, ctx.theme, press !== undefined)} onPress={press}>
            {item.plain_text}
          </Text>
        );
      })}
    </Text>
  );
}

/** A block's text; pressing it opens the text in an input, and links inside still open. */
function BlockText({ block, style }: { block: Block; style: StyleProp<TextStyle> }) {
  const { editor } = useRender();
  const items: RichTextItem[] | undefined = block[block.type]?.rich_text;
  if (!editor || editor.editing !== block.id) {
    return <RichText text={items} style={style} onPress={editor ? () => hasTextSelection() || editor.start(block.id) : undefined} />;
  }
  return (
    <InlineInput
      // Opens again on the block when it changes type or moves.
      key={`${block.type}:${editor.epoch}`}
      initial={(items ?? []) as RichItem[]}
      style={style}
      onSave={(richText) => editor.save(block, richText)}
      onStop={() => editor.stop(block.id)}
      // Enter on an empty list item ends the list, as in Notion.
      onEnter={(empty) =>
        (empty && LIST_TYPES.includes(block.type) && editor.turnInto(block, "paragraph", [])) || editor.insertAfter(block)
      }
      keys={blockKeys(editor, block)}
      // Deleting a block deletes its children, so Backspace removes only childless blocks.
      onEmptyBackspace={block.has_children ? undefined : () => editor.remove(block)}
    />
  );
}

const blockKeys = (editor: BlockEditor, block: Block): InputKeys => ({
  turnInto: (type, richText) => editor.turnInto(block, type, richText),
  act: (action, richText) => editor.act(block, action, richText),
  insert: (type) => editor.insertAfter(block, type),
});

/** The block shortcuts of an input; the first two return true when the block changed, which ends the input. */
interface InputKeys {
  turnInto(type: EditableType, richText: RichItem[]): boolean;
  act(action: BlockAction, richText: RichItem[]): boolean;
  /** Adds a block of this type below. */
  insert(type: EditableType): void;
}

// On the web the key event is the DOM one, which also has the modifiers, the physical key, and the caret.
type KeyEvent = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: { selectionStart?: number; selectionEnd?: number };
};
// By physical key, so they work while a Korean input method is on.
const MARK_KEYS: Record<string, string> = { KeyB: "**", KeyI: "*", KeyE: "`" };

/**
 * Edits text where it is shown, as Markdown so its formatting can be seen and changed. A hidden copy
 * of the text sizes the box, so the input grows and shrinks with it. Enter finishes (Shift+Enter
 * breaks the line), Escape or leaving the input saves. `literal` edits the bare text instead, with
 * Enter breaking the line: for code, and for titles where `*` is just a character.
 * Paseo itself takes Cmd+B, Cmd+E, Cmd+K, and Cmd+Shift+Up/Down before any input sees them, so those
 * work with Ctrl in place of Cmd, and moving also with Option+Shift+Up/Down.
 * With `keys` it takes Notion's shortcuts: Cmd+B/I/E/Shift+S/K write the Markdown markers, `# ` and
 * the other prefixes or Cmd+Option+0-8 change the block type, Tab and Shift+Tab indent, Cmd+Shift+Up/Down
 * move the block, Cmd+D duplicates it, Cmd+Enter checks a to-do, and Up/Down at the text's edge change block.
 */
export function InlineInput({
  initial,
  style,
  onSave,
  onStop,
  onEnter,
  onEmptyBackspace,
  literal,
  breakOnEnter,
  keys,
}: {
  initial: readonly RichItem[];
  literal?: boolean;
  breakOnEnter?: boolean;
  style: StyleProp<TextStyle>;
  onSave(richText: RichItem[]): void;
  onStop(): void;
  onEnter?(empty: boolean): void;
  onEmptyBackspace?(): void;
  keys?: InputKeys;
}) {
  const [text, setText] = useState(() => (literal ? plainText(initial) : toMarkdown(initial)));
  // The caret starts at the end, then follows the user.
  const [caret, setCaret] = useState<{ start: number; end: number } | undefined>({ start: text.length, end: text.length });
  const saved = useRef(text);
  const input = useRef<TextInput>(null);
  // Set once a shortcut changed this block: a new input opens on it with the text, so this one saves nothing more.
  const gone = useRef(false);
  const current = (value = text) => (literal ? editRichText(initial, value) : fromMarkdown(value, initial));
  const commit = () => {
    if (gone.current || text === saved.current) return;
    saved.current = text;
    onSave(current());
  };
  const act = (action: BlockAction) => {
    commit();
    if (keys?.act(action, current())) gone.current = true;
  };
  const edit = (next: string, start: number, end = start) => {
    setText(next);
    setCaret({ start, end });
  };
  // The `/` menu; Escape closes it for the text as it is now.
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const slash = keys && !literal && closedAt !== text ? slashCommand(text) : null;
  const options = slash?.items ?? [];
  const choose = (type: EditableType) => {
    if (!slash || !keys) return;
    const rest = text.slice(0, slash.start);
    // In an empty block the command changes the block; after text it adds a block below.
    if (rest === "" && keys.turnInto(type, [])) return void (gone.current = true);
    setText(rest);
    if (rest === "") return;
    saved.current = rest;
    onSave(current(rest));
    keys.insert(type);
  };
  return (
    <View>
      <View>
        <Text aria-hidden style={[style, { opacity: 0 }]}>
          {text.endsWith("\n") || !text ? `${text} ` : text}
        </Text>
        <TextInput
          ref={input}
          autoFocus
          multiline
          blurOnSubmit={!breakOnEnter}
          value={text}
          selection={caret}
          onChangeText={(next) => {
            const prefix = keys && !gone.current && !literal && !blockPrefix(text) ? blockPrefix(next) : null;
            const turned = !!prefix && !!keys?.turnInto(prefix.type, current(prefix.rest));
            if (turned) gone.current = true;
            setCaret(undefined);
            setText(turned ? prefix!.rest : next);
          }}
          onSelectionChange={() => setCaret(undefined)}
          onSubmitEditing={
            breakOnEnter
              ? undefined
              : () => {
                  commit();
                  onEnter?.(text === "");
                }
          }
          onKeyPress={(event) => {
            const e = event.nativeEvent as KeyEvent;
            const { key, code = "" } = e;
            const mod = e.metaKey || e.ctrlKey;
            const start = e.target?.selectionStart ?? text.length;
            const end = e.target?.selectionEnd ?? start;
            // Also kept from the app's own shortcuts on the same keys.
            const take = () => {
              event.preventDefault();
              event.stopPropagation();
            };
            if (options.length && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(key)) {
              take();
              const at = Math.min(pick, options.length - 1);
              if (key === "Enter") choose(options[at].type);
              else if (key === "Escape") setClosedAt(text);
              else setPick((at + (key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
            } else if (key === "Escape") input.current?.blur();
            else if (key === "Backspace" && text === "" && onEmptyBackspace) {
              // Focus moves to the previous block inside this key press; without this the key would also delete its last character.
              event.preventDefault();
              saved.current = text;
              onEmptyBackspace();
            } else if (key === "Tab" && breakOnEnter) {
              take();
              edit(`${text.slice(0, start)}\t${text.slice(end)}`, start + 1);
            } else if (keys && key === "Tab") {
              take();
              act(e.shiftKey ? "outdent" : "indent");
            } else if (keys && (mod || e.altKey) && e.shiftKey && (key === "ArrowUp" || key === "ArrowDown")) {
              take();
              act(key === "ArrowUp" ? "up" : "down");
            } else if (
              keys &&
              !mod &&
              !e.shiftKey &&
              !e.altKey &&
              start === end &&
              (key === "ArrowUp" ? start === 0 : key === "ArrowDown" && start === text.length)
            ) {
              take();
              act(key === "ArrowUp" ? "previous" : "next");
            } else if (keys && mod && e.altKey && /^Digit[0-8]$/.test(code)) {
              take();
              if (keys.turnInto(TURN_INTO[Number(code[5])], current())) gone.current = true;
            } else if (keys && mod && key === "Enter") {
              take();
              act("check");
            } else if (keys && mod && code === "KeyD") {
              take();
              act("duplicate");
            } else if (mod && !literal && !e.altKey) {
              const sign = e.shiftKey ? (code === "KeyS" || code === "KeyX" ? "~~" : undefined) : MARK_KEYS[code];
              const picked = text.slice(start, end);
              if (sign) {
                take();
                // An odd run of stars before the selection is italic; an even one is only bold.
                const on =
                  sign === "*"
                    ? /\**$/.exec(text.slice(0, start))![0].length % 2 === 1 && text[end] === "*"
                    : text.slice(start - sign.length, start) === sign && text.slice(end, end + sign.length) === sign;
                const size = sign.length;
                if (on) edit(text.slice(0, start - size) + picked + text.slice(end + size), start - size, end - size);
                else edit(text.slice(0, start) + sign + picked + sign + text.slice(end), start + size, end + size);
              } else if (code === "KeyK" && !e.shiftKey) {
                take();
                // The caret waits inside the parentheses for the address.
                edit(`${text.slice(0, start)}[${picked}]()${text.slice(end)}`, end + 3);
              }
            }
          }}
          onBlur={() => {
            commit();
            // A press on the menu takes the focus first; the input stays for it.
            if (!options.length) onStop();
          }}
          style={[style, StyleSheet.absoluteFill, { overflow: "hidden", outlineWidth: 0 }]}
        />
      </View>
      {options.length ? <SlashMenu options={options} pick={Math.min(pick, options.length - 1)} onChoose={choose} /> : null}
    </View>
  );
}

function SlashMenu({
  options,
  pick,
  onChoose,
}: {
  options: readonly { type: EditableType }[];
  pick: number;
  onChoose(type: EditableType): void;
}) {
  const c = useRender().theme.colors;
  const { t } = useTranslation(messages);
  return (
    <View
      accessibilityRole="menu"
      style={{
        alignSelf: "flex-start",
        minWidth: 220,
        marginTop: 4,
        padding: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface0,
      }}
    >
      {options.map((item, i) => (
        <Pressable
          key={item.type}
          accessibilityRole="menuitem"
          onPress={() => onChoose(item.type)}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 5,
            borderRadius: 4,
            backgroundColor: i === pick ? c.surface1 : undefined,
          }}
        >
          <Text
            style={{
              fontFamily: SANS,
              fontSize: 14,
              lineHeight: 20,
              color: c.foreground,
            }}
          >
            {t(`block.${item.type}`)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function linkAction(item: RichTextItem, ctx: RenderContext): (() => void) | undefined {
  const mentioned = item.mention?.page?.id ?? item.mention?.database?.id;
  if (item.type === "mention" && mentioned) return () => ctx.open(mentioned);
  const href = item.href;
  if (!href) return undefined;
  const id = notionIdFromUrl(href);
  return id ? () => ctx.open(id) : () => void openExternalUrl(href);
}

function spanStyle(item: RichTextItem, theme: PluginTheme, link: boolean): TextStyle {
  const a = item.annotations;
  const lines = [a.underline || link ? "underline" : null, a.strikethrough ? "line-through" : null].filter(Boolean).join(" ");
  return {
    // Spans set the family again; the host's nested Text does not inherit it.
    fontFamily: SANS,
    fontWeight: a.bold ? "600" : item.type === "mention" ? "500" : undefined,
    fontStyle: a.italic ? "italic" : undefined,
    textDecorationLine: (lines || undefined) as TextStyle["textDecorationLine"],
    textDecorationColor: link ? theme.colors.foregroundMuted : undefined,
    ...notionColor(a.color),
    ...(a.code
      ? {
          fontFamily: MONO,
          fontSize: 13.6,
          color: theme.colors.statusDanger,
          backgroundColor: theme.colors.surface2,
        }
      : item.type === "equation"
        ? { fontFamily: MONO }
        : null),
  };
}

function Toggle({ header, block, lineHeight = 24, style }: { header: ReactNode; block: Block; lineHeight?: number; style: ViewStyle }) {
  const { theme } = useRender();
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false);
  return (
    <View style={style}>
      {/* Only the chevron toggles, as in Notion; pressing the header text edits it. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        {/* As tall as the header's first line, with its 2px padding, so the chevron centers on it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? t("collapse") : t("expand")}
          aria-expanded={open}
          onPress={() => setOpen(!open)}
          style={{
            width: 24,
            height: lineHeight + 4,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, paddingLeft: 6 }}>{header}</View>
      </View>
      {open && block.children?.length ? (
        <View style={{ paddingLeft: 30 }}>
          <BlockList blocks={block.children} />
        </View>
      ) : null}
    </View>
  );
}

function CodeBlock({ block }: { block: Block }) {
  const { theme, styles, editor } = useRender();
  const toast = useToast();
  const { t } = useTranslation(messages);
  const c = theme.colors;
  const {
    language,
    caption,
    rich_text: items = [],
  } = block.code as {
    language: string;
    caption?: RichTextItem[];
    rich_text?: RichItem[];
  };
  const code = plainText(items);
  const text = {
    fontFamily: MONO,
    fontSize: 13.6,
    lineHeight: 20.4,
    color: c.foreground,
  };
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ borderRadius: 10, backgroundColor: c.surface1 }}>
        {editor?.editing === block.id ? (
          // Long lines wrap while editing; the input cannot scroll sideways with its sizing copy.
          <View style={{ paddingHorizontal: 22, paddingVertical: 36 }}>
            <InlineInput
              literal
              breakOnEnter
              initial={items}
              style={text}
              onSave={(richText) => editor.save(block, richText)}
              key={editor.epoch}
              onStop={() => editor.stop(block.id)}
              keys={blockKeys(editor, block)}
            />
          </View>
        ) : (
          <ScrollView
            horizontal
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingVertical: 36,
              flexGrow: 1,
            }}
          >
            <Text selectable style={[text, { flex: 1 }]} onPress={editor ? () => hasTextSelection() || editor.start(block.id) : undefined}>
              {code || " "}
            </Text>
          </ScrollView>
        )}
        {/* After the code so it stays on top; it sits in the code's top padding. */}
        <View
          style={{
            position: "absolute",
            top: 8,
            left: 22,
            right: 12,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <Text style={[styles.muted, { flex: 1, fontSize: 12, lineHeight: 16 }]}>{language}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("copyCode")}
            hitSlop={6}
            onPress={() =>
              copyText(code).then(
                () => toast.show(t("codeCopied"), { variant: "success" }),
                () => toast.error(t("copyFailed")),
              )
            }
          >
            <Icon name="Copy" size={13} color={c.foregroundMuted} />
          </Pressable>
        </View>
      </View>
      {caption?.length ? <RichText text={caption} style={[styles.muted, { paddingTop: 6 }]} /> : null}
    </View>
  );
}

function ImageBlock({ url, caption }: { url: string; caption?: RichTextItem[] }) {
  const { styles, theme } = useRender();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    Image.getSize(
      url,
      (width, height) => setSize({ width, height }),
      () => setSize(null),
    );
  }, [url]);
  return (
    <View style={{ paddingVertical: 8 }}>
      <Image
        source={{ uri: url }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={{
          width: "100%",
          maxWidth: size?.width,
          aspectRatio: size ? size.width / size.height : 16 / 9,
          borderRadius: 2,
          backgroundColor: size ? undefined : theme.colors.surface1,
        }}
      />
      {caption?.length ? <RichText text={caption} style={[styles.muted, { paddingTop: 6 }]} /> : null}
    </View>
  );
}

function LinkRow({
  node,
  icon,
  fallbackIcon,
  label,
  onPress,
}: {
  node?: NotionNode;
  icon?: string;
  fallbackIcon?: string;
  label: string;
  onPress(): void;
}) {
  const { theme, styles } = useRender();
  const c = theme.colors;
  return (
    <HoverPressable
      colors={c}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 2,
        borderRadius: 4,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {node?.icon || !(icon ?? fallbackIcon) ? (
          <NodeIcon node={node} colors={c} size={18} />
        ) : (
          <Icon name={(icon ?? fallbackIcon)!} size={18} color={c.foregroundMuted} />
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.body,
          {
            flexShrink: 1,
            lineHeight: 21,
            fontWeight: "500",
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          },
        ]}
      >
        {label}
      </Text>
    </HoverPressable>
  );
}

function LinkCard({ url, caption }: { url: string; caption?: RichTextItem[] }) {
  const ctx = useRender();
  const c = ctx.theme.colors;
  const id = notionIdFromUrl(url);
  return (
    <HoverPressable
      colors={c}
      onPress={() => (id ? ctx.open(id) : void openExternalUrl(url))}
      accessibilityRole="link"
      accessibilityLabel={url}
      style={{
        marginVertical: 8,
        padding: 12,
        gap: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="Link" size={14} color={c.foregroundMuted} />
        <Text numberOfLines={1} style={[ctx.styles.muted, { flex: 1, color: c.foreground }]}>
          {url}
        </Text>
      </View>
      {caption?.length ? <RichText text={caption} style={ctx.styles.muted} /> : null}
    </HoverPressable>
  );
}

function TableBlock({ block }: { block: Block }) {
  const { theme, styles } = useRender();
  const c = theme.colors;
  const rows = block.children ?? [];
  const { has_column_header: columnHeader, has_row_header: rowHeader } = block.table ?? {};
  return (
    // Notion keeps 24px under tables for its scrollbar and add-row button.
    <ScrollView horizontal style={{ paddingTop: 16, paddingBottom: 32 }}>
      <View style={{ borderWidth: 1, borderColor: c.border }}>
        {rows.map((row, r) => (
          <View key={row.id} style={{ flexDirection: "row" }}>
            {(row.table_row?.cells ?? []).map((cell: RichTextItem[], i: number, cells: unknown[]) => {
              const header = (columnHeader && r === 0) || (rowHeader && i === 0);
              return (
                <View
                  key={i}
                  style={{
                    // Notion's default column width; the API does not return resized widths.
                    width: 120,
                    paddingHorizontal: 9,
                    paddingVertical: 7,
                    borderRightWidth: i < cells.length - 1 ? 1 : 0,
                    borderBottomWidth: r < rows.length - 1 ? 1 : 0,
                    borderColor: c.border,
                    backgroundColor: header ? c.surface1 : undefined,
                  }}
                >
                  <RichText text={cell} style={[styles.body, { fontSize: 14, lineHeight: 20 }, header ? { fontWeight: "500" } : null]} />
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
