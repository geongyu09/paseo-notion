import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describeWorkspace, editPage, getDatabase, forgetOtherWorkspaces, getIndex, getPage, hashToken } from "./server/notion";
import { pickToken } from "./server/token";
import { connection, databaseRpc, editRpc, indexRpc, pageRpc, workspacesRpc } from "./shared/notion";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(connection);
  const tokensOf = (values: { tokens: string[] }) => values.tokens.map((token) => token.trim()).filter(Boolean);
  const tokens = async () => {
    const state = await settings.read();
    return state.status === "ready" ? tokensOf(state.values) : [];
  };
  const tokenFor = async (space: string | null) => pickToken(await tokens(), space, hashToken);
  // A removed workspace's request must never run under another workspace's token.
  const missing = (space: string | null) =>
    new Error(space === null ? "No Notion token is set." : "The token for this Notion workspace was removed.");

  server.handle(workspacesRpc, async () => Promise.all((await tokens()).map(describeWorkspace)));

  server.handle(indexRpc, async ({ space, refresh }) => {
    const token = await tokenFor(space);
    if (!token) return space === null ? { status: "no-token" as const } : { status: "workspace-removed" as const };
    return { status: "ready" as const, space: hashToken(token), ...(await getIndex(token, refresh)) };
  });

  server.handle(pageRpc, async ({ space, id }) => {
    const token = await tokenFor(space);
    if (!token) throw missing(space);
    return getPage(token, id);
  });

  server.handle(databaseRpc, async ({ space, id, cursor }) => {
    const token = await tokenFor(space);
    if (!token) throw missing(space);
    return getDatabase(token, id, cursor);
  });

  server.handle(editRpc, async ({ space, pageId, change }) => {
    const token = await tokenFor(space);
    if (!token) throw missing(space);
    return editPage(token, pageId, change);
  });

  // Unreadable settings must not wipe every cached tree.
  const forget = (state: Awaited<ReturnType<typeof settings.read>>) =>
    state.status === "ready" ? forgetOtherWorkspaces(tokensOf(state.values)) : undefined;
  settings.read().then(forget).catch((error) => console.error("Removing old Notion trees failed", error));
  return settings.subscribe(forget);
}
