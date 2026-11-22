import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, type PluginWorkspacePanelProps, useTabState, useTranslation } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import type { RichItem } from "../shared/edit";
import type { NotionNode, NotionPage } from "../shared/notion";
import { ancestry } from "../shared/tree";
import { type Block, InlineInput, NotionBlocks } from "./Blocks";
import { databaseKey, resolveTarget, useNotionIndex, useNotionPage, useRefreshIndex } from "./data";
import { DatabaseView } from "./Database";
import { useEditor } from "./editor";
import { SANS } from "./look";
import { messages } from "./messages";
import { HoverPressable, IconButton, NodeIcon, Notice, useValueText } from "./parts";
import { goBack, navigate, restore, usePlace } from "./store";
import { hasTextSelection } from "./web";

const tabSchema = z.object({ id: z.string().nullable(), space: z.string().nullable().default(null) });
type Colors = PluginTheme["colors"];

export interface PageActions {
  openSettings(): void;
}

export function createPagePanel(actions: PageActions) {
  return function NotionPage(props: PluginWorkspacePanelProps) {
    return <PagePanel {...props} actions={actions} />;
  };
}

function PagePanel({ theme, layout, workspaceId, tab, actions }: PluginWorkspacePanelProps & { actions: PageActions }) {
  const colors = theme.colors;
  const [saved, setSaved] = useTabState(tab, tabSchema, { id: null, space: null });
  const place = usePlace(workspaceId);
  const id = place?.id ?? saved.id;
  const space = place ? place.space : saved.space;
  const { query, nodes, byId } = useNotionIndex(space);
  const client = useQueryClient();
  const refreshIndex = useRefreshIndex(space);
  const node = id ? byId.get(id) : undefined;
  const { t } = useTranslation(messages);

  useEffect(() => {
    if (!place && saved.id) restore(workspaceId, { space: saved.space, id: saved.id });
    else if (place && (place.id !== saved.id || place.space !== saved.space)) setSaved({ id: place.id, space: place.space });
  }, [place, saved.id, saved.space, setSaved, workspaceId]);

  // Links inside a page stay in its workspace.
  const open = useCallback(
    (target: string) => navigate(workspaceId, { space, id: resolveTarget(byId, nodes, target) }, id ? { space, id } : null),
    [workspaceId, byId, nodes, id, space],
  );
  const lookup = useCallback((target: string) => byId.get(resolveTarget(byId, nodes, target)), [byId, nodes]);

  if (!id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
        <Notice colors={colors} title={t("noOpenPage")} detail={t("noOpenPageDetail")} />
      </View>
    );
  }

  // The daemon rejects this workspace's requests, so ask for its token instead of showing the page.
  if (query.data?.status === "workspace-removed") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
        <Notice
          colors={colors}
          title={t("workspaceRemoved")}
          detail={t("workspaceRemovedDetail")}
          action={{ label: t("openSettings"), onPress: actions.openSettings }}
        />
      </View>
    );
  }

  // Notion's 708px reading column, with its title starting 80px below the top bar.
  const padding = layout.compact ? 24 : 48;
  const top = layout.compact ? 32 : 80;
  const column = { width: "100%", maxWidth: 708 + padding * 2, alignSelf: "center", paddingHorizontal: padding } as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      {node?.kind === "database" ? (
        <>
          <Toolbar
            colors={colors}
            workspaceId={workspaceId}
            canGoBack={!!place?.back.length}
            trail={ancestry(byId, id)}
            url={node.url}
            open={open}
            onRefresh={() => {
              refreshIndex.mutate();
              void client.resetQueries({ queryKey: databaseKey(space, id) });
            }}
            refreshing={refreshIndex.isPending}
          />
          <DatabaseView
            key={id}
            space={space}
            id={id}
            colors={colors}
            padding={padding}
            top={top}
            open={open}
            header={<Header colors={colors} node={node} title={node.title} />}
          />
        </>
      ) : (
        <PageView
          key={id}
          id={id}
          space={space}
          node={node}
          theme={theme}
          compact={layout.compact}
          column={column}
          top={top}
          open={open}
          lookup={lookup}
          renderToolbar={(url, refresh, refreshing) => (
            <Toolbar
              colors={colors}
              workspaceId={workspaceId}
              canGoBack={!!place?.back.length}
              trail={ancestry(byId, id)}
              url={node?.url ?? url}
              open={open}
              onRefresh={refresh}
              refreshing={refreshing}
            />
          )}
        />
      )}
    </View>
  );
}

function PageView({
  id,
  space,
  node,
  theme,
  compact,
  column,
  top,
  open,
  lookup,
  renderToolbar,
}: {
  id: string;
  space: string | null;
  node: NotionNode | undefined;
  theme: PluginTheme;
  compact: boolean;
  column: object;
  top: number;
  open(id: string): void;
  lookup(id: string): NotionNode | undefined;
  renderToolbar(url: string | undefined, refresh: () => void, refreshing: boolean): ReactNode;
}) {
  const colors = theme.colors;
  const page = useNotionPage(space, id);
  const editor = useEditor(space, id);
  const { t } = useTranslation(messages);
  const body = (() => {
    if (page.isPending) return <Notice colors={colors} busy title={t("loadingPage")} />;
    if (page.isError) {
      return (
        <Notice
          colors={colors}
          title={t("pageFailed")}
          detail={page.error.message}
          action={{ label: t("retry"), onPress: () => void page.refetch() }}
        />
      );
    }
    return (
      <View>
        {page.data.properties.length ? <Properties colors={colors} properties={page.data.properties} /> : null}
        <NotionBlocks blocks={page.data.blocks as Block[]} theme={theme} compact={compact} open={open} node={lookup} editor={editor} />
      </View>
    );
  })();
  return (
    <>
      {renderToolbar(page.data?.url, () => void page.refetch(), page.isFetching && !page.isPending)}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[column, { paddingTop: top, paddingBottom: 64, flexGrow: 1 }]}>
        <Header
          colors={colors}
          node={node}
          title={page.data?.title ?? node?.title ?? ""}
          emoji={page.data?.icon ?? node?.icon}
          titleRich={page.data?.titleRich as RichItem[] | undefined}
          onRename={page.data ? editor.rename : undefined}
        />
        {body}
      </ScrollView>
    </>
  );
}

function Toolbar({
  colors,
  workspaceId,
  canGoBack,
  trail,
  url,
  open,
  onRefresh,
  refreshing,
}: {
  colors: Colors;
  workspaceId: string;
  canGoBack: boolean;
  trail: NotionNode[];
  url: string | undefined;
  open(id: string): void;
  onRefresh(): void;
  refreshing: boolean;
}) {
  const { t } = useTranslation(messages);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 40,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <IconButton colors={colors} name="ArrowLeft" label={t("back")} disabled={!canGoBack} onPress={() => goBack(workspaceId)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ alignItems: "center", gap: 2 }}
      >
        {trail.map((crumb, i) => (
          <Fragment key={crumb.id}>
            {i > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>/</Text> : null}
            <HoverPressable
              colors={colors}
              onPress={() => open(crumb.id)}
              accessibilityLabel={crumb.title || t("untitled")}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, height: 26, borderRadius: 6 }}
            >
              {crumb.icon ? <Text style={{ fontSize: 13 }}>{crumb.icon}</Text> : null}
              <Text
                numberOfLines={1}
                style={{
                  maxWidth: 200,
                  fontSize: 13,
                  color: i === trail.length - 1 ? colors.foreground : colors.foregroundMuted,
                }}
              >
                {crumb.title || t("untitled")}
              </Text>
            </HoverPressable>
          </Fragment>
        ))}
      </ScrollView>
      <IconButton colors={colors} name="RotateCw" label={t("refresh")} busy={refreshing} onPress={onRefresh} />
      <IconButton
        colors={colors}
        name="ExternalLink"
        label={t("openInNotion")}
        disabled={!url}
        onPress={() => url && void openExternalUrl(url)}
      />
    </View>
  );
}

function Header({
  colors,
  node,
  title,
  emoji,
  detail,
  titleRich,
  onRename,
}: {
  colors: Colors;
  node: NotionNode | undefined;
  title: string;
  emoji?: string | null;
  detail?: string;
  titleRich?: readonly RichItem[];
  /** Makes the title editable. */
  onRename?(title: RichItem[]): void;
}) {
  const icon = emoji ?? node?.icon;
  const [renaming, setRenaming] = useState(false);
  const { t } = useTranslation(messages);
  const style = { color: colors.foreground, fontFamily: SANS, fontSize: 40, lineHeight: 48, fontWeight: "700" } as const;
  return (
    <View style={{ marginBottom: 16 }}>
      {icon ? <Text style={{ fontSize: 78, lineHeight: 86, marginBottom: 4 }}>{icon}</Text> : null}
      {renaming && onRename ? (
        <InlineInput literal initial={titleRich ?? []} style={style} onSave={onRename} onStop={() => setRenaming(false)} />
      ) : (
        <Text
          selectable
          style={[style, title ? null : { color: colors.foregroundMuted }]}
          onPress={onRename ? () => hasTextSelection() || setRenaming(true) : undefined}
        >
          {title || t("untitled")}
        </Text>
      )}
      {detail ? (
        <Text style={{ color: colors.foregroundMuted, fontFamily: SANS, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{detail}</Text>
      ) : null}
    </View>
  );
}

// Notion's property rows: 34px tall, a 160px name column, 14px text.
const cell = { fontFamily: SANS, fontSize: 14, lineHeight: 21, paddingHorizontal: 6, paddingVertical: 6.5 } as const;

function Properties({ colors, properties }: { colors: Colors; properties: NotionPage["properties"] }) {
  const valueText = useValueText();
  return (
    <View style={{ gap: 4, paddingBottom: 12, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {properties.map((property) => (
        <View key={property.name} style={{ flexDirection: "row", gap: 4 }}>
          <Text numberOfLines={1} style={[cell, { width: 160, color: colors.foregroundMuted }]}>
            {property.name}
          </Text>
          <Text selectable style={[cell, { flex: 1, color: colors.foreground }]}>
            {valueText(property)}
          </Text>
        </View>
      ))}
    </View>
  );
}
