import { Platform } from "react-native";

// The only DOM global this plugin reads, declared here because the project compiles without the DOM lib.
declare const document: { getSelection(): { isCollapsed: boolean } | null };

/** True while text is selected on the web; a press that ends a drag selection must not open an input over it. */
export const hasTextSelection = () => Platform.OS === "web" && document.getSelection()?.isCollapsed === false;
