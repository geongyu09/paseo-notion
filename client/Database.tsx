import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { useTranslation } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import type { DatabaseCell } from "../shared/notion";
import { useNotionDatabase } from "./data";
import { notionColor, SANS } from "./look";
import { messages } from "./messages";
import { HoverPressable, Notice, useValueText } from "./parts";

type Colors = PluginTheme["colors"];

// Notion's table: 14px text, rows about 34px tall, a wide title column.
const TITLE_WIDTH = 300;
const CELL_WIDTH = 180;
const text = { fontFamily: SANS, fontSize: 14, lineHeight: 20 } as const;

/** A database as Notion's table view: one row per page, one column per property, newest edit first. */
export function DatabaseView({
  space,
  id,
  colors,
  padding,
  top,
  open,
  header,
}: {
  space: string | null;
  id: string;
  colors: Colors;
  padding: number;
  top: number;
  open(id: string): void;
  header: ReactNode;
}) {
  const query = useNotionDatabase(space, id);
  const { t } = useTranslation(messages);
  const columns = query.data?.pages[0].columns ?? [];
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  const line = { borderBottomWidth: 1, borderBottomColor: colors.border } as const;
  const cellBox = (i: number) =>
    ({ width: i === 0 ? TITLE_WIDTH : CELL_WIDTH, paddingHorizontal: 8, paddingVertical: 7, justifyContent: "center" }) as const;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: top, paddingBottom: 64, flexGrow: 1 }}>
      <View style={{ paddingHorizontal: padding }}>{header}</View>
      {query.isPending ? (
        <Notice colors={colors} busy title={t("loadingDatabase")} />
      ) : query.isError ? (
        <Notice
          colors={colors}
          title={t("databaseFailed")}
          detail={query.error.message}
          action={{ label: t("retry"), onPress: () => void query.refetch() }}
        />
      ) : (
        <>
          <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: padding }}>
            <View>
              <View style={[{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }, line]}>
                {columns.map((column, i) => (
                  <View key={column.name} style={cellBox(i)}>
                    <Text numberOfLines={1} style={[text, { color: colors.foregroundMuted }]}>
                      {column.name}
                    </Text>
                  </View>
                ))}
              </View>
              {rows.map((row) => (
                <View key={row.id} style={[{ flexDirection: "row" }, line]}>
                  {row.cells.map((cell, i) =>
                    i === 0 ? (
                      <HoverPressable
                        key={i}
                        colors={colors}
                        onPress={() => open(row.id)}
                        accessibilityRole="link"
                        accessibilityLabel={cell.text || t("untitled")}
                        style={[cellBox(i), { flexDirection: "row", justifyContent: "flex-start", alignItems: "center", gap: 6 }]}
                      >
                        {row.icon ? (
                          <Text style={{ fontSize: 14 }}>{row.icon}</Text>
                        ) : (
                          <Icon name="FileText" size={14} color={colors.foregroundMuted} />
                        )}
                        <Text
                          numberOfLines={1}
                          style={[text, { flex: 1, fontWeight: "500", color: cell.text ? colors.foreground : colors.foregroundMuted }]}
                        >
                          {cell.text || t("untitled")}
                        </Text>
                      </HoverPressable>
                    ) : (
                      <View key={i} style={cellBox(i)}>
                        <Cell cell={cell} colors={colors} />
                      </View>
                    ),
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={{ paddingHorizontal: padding, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={[text, { color: colors.foregroundMuted }]}>
              {!rows.length
                ? t("noPages")
                : query.hasNextPage
                  ? t("rowsShowing", { count: rows.length })
                  : t("rows", { count: rows.length })}
            </Text>
            {query.hasNextPage ? (
              <HoverPressable
                colors={colors}
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
                accessibilityRole="button"
                accessibilityLabel={t("loadMoreRows")}
                style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}
              >
                <Text style={[text, { color: colors.foreground }]}>{query.isFetchingNextPage ? t("loading") : t("loadMore")}</Text>
              </HoverPressable>
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Cell({ cell, colors }: { cell: DatabaseCell; colors: Colors }) {
  const valueText = useValueText();
  if (cell.checked !== undefined) {
    return (
      <View
        accessibilityRole="checkbox"
        aria-checked={cell.checked}
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: cell.checked ? "#2383e2" : colors.foregroundMuted,
          backgroundColor: cell.checked ? "#2383e2" : undefined,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cell.checked ? <Icon name="Check" size={12} color="#ffffff" /> : null}
      </View>
    );
  }
  if (cell.chips) {
    return (
      <View style={{ flexDirection: "row", gap: 4, overflow: "hidden" }}>
        {cell.chips.map((chip) => (
          <Text
            key={chip.name}
            numberOfLines={1}
            style={[
              text,
              { color: colors.foreground, paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.surface2 },
              notionColor(`${chip.color}_background`),
            ]}
          >
            {chip.name}
          </Text>
        ))}
      </View>
    );
  }
  return (
    <Text numberOfLines={1} selectable style={[text, { color: colors.foreground }]}>
      {valueText(cell)}
    </Text>
  );
}
