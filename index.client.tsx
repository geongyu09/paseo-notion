import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createExplorer } from "./client/Explorer";
import { createPagePanel } from "./client/PagePanel";
import { messages } from "./client/messages";
import { ConnectionSettings } from "./client/Settings";
import { navigate } from "./client/store";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings("connection");
  const removers = [
    client.addWorkspacePanel({
      id: "tree",
      title: messages.message("notion"),
      icon: "NotebookText",
      locations: ["explorer"],
      Component: createExplorer({
        openPage(workspaceId, spot) {
          navigate(workspaceId, spot);
          client.openPanel("page", { workspaceId, location: "workspace" });
        },
        openSettings,
      }),
    }),
    client.addWorkspacePanel({
      id: "page",
      title: messages.message("notionPage"),
      icon: "NotebookText",
      locations: ["workspace"],
      Component: createPagePanel({ openSettings }),
    }),
    client.addSettingsScreen({ id: "connection", title: messages.message("connection"), icon: "KeyRound", Component: ConnectionSettings }),
    client.addCommandCenterItem({
      id: "open-tree",
      title: messages.message("openTree"),
      icon: "NotebookText",
      keywords: ["notion", "노션"],
      context: "workspace",
      onSelect: ({ openPanel }) => openPanel("tree", { location: "explorer" }),
    }),
  ];
  return () => removers.forEach((remove) => remove());
}
