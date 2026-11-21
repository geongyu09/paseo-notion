import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { databaseRpc, indexRpc, type NotionNode, pageRpc, workspacesRpc } from "../shared/notion";
import { childrenByParent } from "../shared/tree";
import { messages } from "./messages";

const indexKey = (space: string | null) => ["notion", "index", space];
const NO_NODES: NotionNode[] = [];

export function useWorkspaces() {
  const load = useRpc(workspacesRpc);
  const { t } = useTranslation(messages);
  return useQuery({
    queryKey: ["notion", "workspaces"],
    queryFn: () => load({}),
    staleTime: 5 * 60_000,
    // Named here, so every consumer shows the app language.
    select: (list) =>
      list.map(({ id, name, error }) => ({ id, name: error ? t("connectionError", { message: error }) : (name ?? t("unnamedWorkspace")) })),
  });
}

export function useNotionIndex(space: string | null) {
  const load = useRpc(indexRpc);
  const query = useQuery({
    queryKey: indexKey(space),
    queryFn: () => load({ space, refresh: false }),
    staleTime: 30_000,
    // The daemon rebuilds a stale tree in the background; poll briefly until it lands.
    refetchInterval: (state) => (state.state.data?.status === "ready" && state.state.data.refreshing ? 3_000 : 60_000),
  });
  const nodes = query.data?.status === "ready" ? query.data.nodes : NO_NODES;
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const children = useMemo(() => childrenByParent(nodes), [nodes]);
  return { query, nodes, byId, children };
}

export function useRefreshIndex(space: string | null) {
  const load = useRpc(indexRpc);
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => load({ space, refresh: true }),
    onSuccess: (data) => client.setQueryData(indexKey(space), data),
  });
}

export const pageKey = (space: string | null, id: string) => ["notion", "page", space, id];

export function useNotionPage(space: string | null, id: string) {
  const load = useRpc(pageRpc);
  return useQuery({ queryKey: pageKey(space, id), queryFn: () => load({ space, id }),
    staleTime: 30_000,
    // Edits live in this data under local block IDs; a reload behind the user's back would close the block being typed in.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export const databaseKey = (space: string | null, id: string) => ["notion", "database", space, id];

export function useNotionDatabase(space: string | null, id: string) {
  const load = useRpc(databaseRpc);
  return useInfiniteQuery({
    queryKey: databaseKey(space, id),
    queryFn: ({ pageParam }) => load({ space, id, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
}

/** Child database blocks and database mentions carry the database ID; the tree keys databases by data source. */
export function resolveTarget(byId: ReadonlyMap<string, NotionNode>, nodes: readonly NotionNode[], id: string): string {
  if (byId.has(id)) return id;
  return nodes.find((node) => node.databaseId === id)?.id ?? id;
}
