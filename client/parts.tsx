import type { PluginTheme } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Pressable, type StyleProp, Text, View, type ViewStyle } from "react-native";
import type { NotionNode, PropertyValue } from "../shared/notion";
import { messages } from "./messages";

/** Words a property value from the daemon in the app language. */
export function useValueText() {
  const { t } = useTranslation(messages);
  return (value: PropertyValue) =>
    value.checked !== undefined
      ? t(value.checked ? "yes" : "no")
      : value.links
        ? t("links", { count: value.links })
        : value.items
          ? t("items", { count: value.items })
          : value.text;
}

type Colors = PluginTheme["colors"];

/** A pressable that paints the hover and press feedback desktop and touch users expect. */
export function HoverPressable({
  colors,
  active = false,
  style,
  children,
  ...props
}: {
  colors: Colors;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  onPress(): void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  hitSlop?: number;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        style,
        (active || hovered || pressed) && !props.disabled
          ? { backgroundColor: active || pressed ? colors.surface2 : colors.surface1 }
          : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function IconButton({
  colors,
  name,
  label,
  onPress,
  disabled,
  busy,
}: {
  colors: Colors;
  name: string;
  label: string;
  onPress(): void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <HoverPressable
      colors={colors}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={label}
      hitSlop={4}
      style={{ width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.foregroundMuted} />
      ) : (
        <Icon name={name} size={15} color={disabled ? colors.border : colors.foregroundMuted} />
      )}
    </HoverPressable>
  );
}

export function NodeIcon({ node, colors, size }: { node: NotionNode | undefined; colors: Colors; size: number }) {
  if (node?.icon) {
    return <Text style={{ fontSize: size - 1, lineHeight: size + 4, width: size + 2, textAlign: "center" }}>{node.icon}</Text>;
  }
  return (
    <View style={{ width: size + 2, alignItems: "center" }}>
      <Icon name={node?.kind === "database" ? "Database" : "FileText"} size={size} color={colors.foregroundMuted} />
    </View>
  );
}

/** Centered message with an optional action, for loading, empty, and error states. */
export function Notice({
  colors,
  title,
  detail,
  busy,
  action,
}: {
  colors: Colors;
  title: string;
  detail?: string;
  busy?: boolean;
  action?: { label: string; onPress(): void };
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
      {busy ? <ActivityIndicator color={colors.foregroundMuted} /> : null}
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {detail ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19, textAlign: "center" }}>{detail}</Text>
      ) : null}
      {action ? (
        <HoverPressable
          colors={colors}
          onPress={action.onPress}
          style={{
            marginTop: 6,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 13 }}>{action.label}</Text>
        </HoverPressable>
      ) : null}
    </View>
  );
}
