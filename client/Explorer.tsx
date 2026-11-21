import { type PluginWorkspacePanelProps, useTabState, useTranslation } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { ancestry, searchRows, type TreeRow, visibleRows } from "../shared/tree";
import { useNotionIndex, useRefreshIndex, useWorkspaces } from "./data";
import { messages } from "./messages";
import { HoverPressable, IconButton, NodeIcon, Notice } from "./parts";
import { type Spot, usePlace } from "./store";

const tabSchema = z.object({ expanded: z.array(z.string()), space: z.string().nullable().default(null) });
const ROW_HEIGHT = 28;
const INDENT = 14;

export interface ExplorerActions {
  openPage(workspaceId: string, spot: Spot): void;
  openSettings(): void;
}

export function createExplorer(actions: ExplorerActions) {
  return function NotionExplorer({ theme, workspaceId, tab }: PluginWorkspacePanelProps) {
    const colors = theme.colors;
    const [state, setState] = useTabState(tab, tabSchema, { expanded: [], space: null });
    const { query, nodes, byId, children } = useNotionIndex(state.space);
    const refresh = useRefreshIndex(state.space);
    const workspaces = useWorkspaces();
    const { t } = useTranslation(messages);
    const [picking, setPicking] = useState(false);
    const [search, setSearch] = useState("");
    // The daemon falls back to the first token, so its answer names the workspace on screen.
    const space = query.data?.status === "ready" ? query.data.space : state.space;
    const expanded = useMemo(() => new Set(state.expanded), [state.expanded]);
    const activeId = usePlace(workspaceId)?.id;

    // Reveal the page shown in the center, as a file explorer reveals the open file.
    useEffect(() => {
      if (!activeId) return;
      const hidden = ancestry(byId, activeId)
        .slice(0, -1)
        .map((node) => node.id)
        .filter((id) => !expanded.has(id));
      if (hidden.length) setState({ ...state, expanded: [...state.expanded, ...hidden] });
      // Only a newly shown page should expand its ancestors, not a manual collapse.
    }, [activeId, byId]);

    const rows = useMemo(
      () => (search.trim() ? searchRows(nodes, search) : visibleRows(children, expanded)),
      [search, nodes, children, expanded],
    );

    const toggle = (id: string) =>
      setState({ ...state, expanded: expanded.has(id) ? state.expanded.filter((x) => x !== id) : [...state.expanded, id] });

    const body = (() => {
      if (query.isPending) {
        return (
          <Notice colors={colors} busy title={t("loadingTree")} detail={t("firstLoadSlow")} />
        );
      }
      if (query.isError) {
        return (
          <Notice
            colors={colors}
            title={t("treeFailed")}
            detail={query.error.message}
            action={{ label: t("retry"), onPress: () => void query.refetch() }}
          />
        );
      }
      if (query.data.status === "no-token") {
        return (
          <Notice
            colors={colors}
            title={t("tokenNeeded")}
            detail={t("tokenNeededDetail")}
            action={{ label: t("openSettings"), onPress: actions.openSettings }}
          />
        );
      }
      if (!rows.length) {
        return <Notice colors={colors} title={search.trim() ? t("noResults") : t("noSharedPages")} />;
      }
      return (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.node.id}
          extraData={[activeId, expanded]}
          contentContainerStyle={{ paddingVertical: 4 }}
          renderItem={({ item }) => (
            <Row
              row={item}
              colors={colors}
              active={item.node.id === activeId}
              expanded={expanded.has(item.node.id)}
              onOpen={() => actions.openPage(workspaceId, { space, id: item.node.id })}
              onToggle={() => toggle(item.node.id)}
            />
          )}
        />
      );
    })();

    const refreshing = refresh.isPending || (query.data?.status === "ready" && query.data.refreshing);
    const current = workspaces.data?.find((workspace) => workspace.id === space);
    const pickerRow = { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 8, borderRadius: 6 } as const;
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
        {workspaces.data?.length ? (
          <View style={{ paddingHorizontal: 4, paddingTop: 6 }}>
            <HoverPressable
              colors={colors}
              onPress={() => setPicking(!picking)}
              accessibilityLabel={t("pickWorkspace", { name: current?.name ?? "" })}
              style={pickerRow}
            >
              <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
                {current?.name ?? t("workspace")}
              </Text>
              <Icon name="ChevronsUpDown" size={13} color={colors.foregroundMuted} />
            </HoverPressable>
            {picking ? (
              <View style={{ paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.border }}>
                {workspaces.data.map((workspace) => (
                  <HoverPressable
                    key={workspace.id}
                    colors={colors}
                    active={workspace.id === space}
                    accessibilityLabel={workspace.name}
                    onPress={() => {
                      setPicking(false);
                      if (workspace.id !== space) setState({ ...state, space: workspace.id });
                    }}
                    style={pickerRow}
                  >
                    {workspace.id === space ? (
                      <Icon name="Check" size={13} color={colors.foreground} />
                    ) : (
                      <View style={{ width: 13 }} />
                    )}
                    <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 13 }}>
                      {workspace.name}
                    </Text>
                  </HoverPressable>
                ))}
                <HoverPressable
                  colors={colors}
                  accessibilityLabel={t("addWorkspaceToken")}
                  onPress={() => {
                    setPicking(false);
                    actions.openSettings();
                  }}
                  style={pickerRow}
                >
                  <Icon name="Plus" size={13} color={colors.foregroundMuted} />
                  <Text numberOfLines={1} style={{ flex: 1, color: colors.foregroundMuted, fontSize: 13 }}>
                    {t("addWorkspace")}
                  </Text>
                </HoverPressable>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: 28,
              paddingHorizontal: 8,
              borderRadius: 6,
              backgroundColor: colors.surface1,
            }}
          >
            <Icon name="Search" size={13} color={colors.foregroundMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t("searchPages")}
              placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel={t("searchNotionPages")}
              style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, padding: 0, outlineWidth: 0 }}
            />
            {search ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("clearSearch")} hitSlop={6} onPress={() => setSearch("")}>
                <Icon name="X" size={13} color={colors.foregroundMuted} />
              </Pressable>
            ) : null}
          </View>
          <IconButton
            colors={colors}
            name="RotateCw"
            label={t("refreshTree")}
            busy={refreshing}
            disabled={query.data?.status !== "ready"}
            onPress={() => refresh.mutate()}
          />
        </View>
        {refresh.isError ? (
          <Text style={{ color: colors.statusDanger, fontSize: 12, paddingHorizontal: 12, paddingBottom: 4 }}>
            {refresh.error.message}
          </Text>
        ) : null}
        {body}
      </View>
    );
  };
}

function Row({
  row,
  colors,
  active,
  expanded,
  onOpen,
  onToggle,
}: {
  row: TreeRow;
  colors: PluginWorkspacePanelProps["theme"]["colors"];
  active: boolean;
  expanded: boolean;
  onOpen(): void;
  onToggle(): void;
}) {
  const { t } = useTranslation(messages);
  const title = row.node.title.trim() || t("untitled");
  return (
    <HoverPressable
      colors={colors}
      active={active}
      onPress={onOpen}
      accessibilityLabel={title}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: ROW_HEIGHT,
        marginHorizontal: 4,
        paddingLeft: 2 + row.depth * INDENT,
        paddingRight: 8,
        borderRadius: 6,
        gap: 4,
      }}
    >
      {row.hasChildren ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? t("collapseTitle", { title }) : t("expandTitle", { title })}
          aria-expanded={expanded}
          onPress={onToggle}
          hitSlop={4}
          style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
        </Pressable>
      ) : (
        <View style={{ width: 18, height: 18 }} />
      )}
      <NodeIcon node={row.node} colors={colors} size={14} />
      <View style={{ flex: 1, minWidth: 0, paddingVertical: row.path ? 3 : 0 }}>
        <Text
          numberOfLines={1}
          style={{
            color: row.node.title.trim() ? colors.foreground : colors.foregroundMuted,
            fontSize: 13,
            fontWeight: active ? "600" : "400",
          }}
        >
          {title}
        </Text>
        {row.path ? (
          <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            {row.path}
          </Text>
        ) : null}
      </View>
    </HoverPressable>
  );
}
