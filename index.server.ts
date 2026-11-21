import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describeWorkspace, editPage, getDatabase, forgetOtherWorkspaces, getIndex, getPage, hashToken } from "./server/notion";
import { connection, databaseRpc, editRpc, indexRpc, pageRpc, workspacesRpc } from "./shared/notion";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(connection);
  const tokensOf = (values: { tokens: string[] }) => values.tokens.map((token) => token.trim()).filter(Boolean);
  const tokens = async () => {
    const state = await settings.read();
    return state.status === "ready" ? tokensOf(state.values) : [];
  };
  const tokenFor = async (space: string | null) => {
    const all = await tokens();
    return all.find((token) => hashToken(token) === space) ?? all[0];
  };

  server.handle(workspacesRpc, async () => Promise.all((await tokens()).map(describeWorkspace)));

  server.handle(indexRpc, async ({ space, refresh }) => {
    const token = await tokenFor(space);
    if (!token) return { status: "no-token" as const };
    return { status: "ready" as const, space: hashToken(token), ...(await getIndex(token, refresh)) };
  });

  server.handle(pageRpc, async ({ space, id }) => {
    const token = await tokenFor(space);
    if (!token) throw new Error("No Notion token is set.");
    return getPage(token, id);
  });

  server.handle(databaseRpc, async ({ space, id, cursor }) => {
    const token = await tokenFor(space);
    if (!token) throw new Error("No Notion token is set.");
    return getDatabase(token, id, cursor);
  });

  server.handle(editRpc, async ({ space, pageId, change }) => {
    const token = await tokenFor(space);
    if (!token) throw new Error("No Notion token is set.");
    return editPage(token, pageId, change);
  });

  // Unreadable settings must not wipe every cached tree.
  const forget = (state: Awaited<ReturnType<typeof settings.read>>) =>
    state.status === "ready" ? forgetOtherWorkspaces(tokensOf(state.values)) : undefined;
  settings.read().then(forget).catch((error) => console.error("Removing old Notion trees failed", error));
  return settings.subscribe(forget);
}
