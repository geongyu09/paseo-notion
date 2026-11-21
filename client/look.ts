import { Platform } from "react-native";

// Notion's own font stacks on web; native platforms keep their system fonts.
export const SANS = Platform.select({
  web: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"',
  default: undefined,
});

export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: 'SFMono-Regular, Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace',
});

/** #rrggbb as rgba with the given alpha; other color strings are returned unchanged. */
export function tint(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Notion's named colors as mid-tones that read on both light and dark surfaces.
const NOTION_COLORS: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#a27763",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#4f9768",
  blue: "#447acb",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#d44c47",
};

/** Text color for "red", a tinted background for "red_background", nothing for "default". */
export function notionColor(name: string | undefined): { color?: string; backgroundColor?: string } {
  if (!name || name === "default") return {};
  const background = name.endsWith("_background");
  const hex = NOTION_COLORS[name.replace("_background", "")];
  if (!hex) return {};
  return background ? { backgroundColor: tint(hex, 0.16) } : { color: hex };
}
