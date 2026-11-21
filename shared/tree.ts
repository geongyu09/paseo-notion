import type { NotionNode } from "./notion";

export interface TreeRow {
  node: NotionNode;
  depth: number;
  hasChildren: boolean;
  /** Search results only: the parent's title. */
  path?: string;
}

/** Points database parents at their data source node and turns nodes whose parent is not shared into roots. */
export function linkParents(nodes: NotionNode[]): NotionNode[] {
  const sourceByDatabase = new Map<string, string>();
  for (const node of nodes) if (node.databaseId) sourceByDatabase.set(node.databaseId, node.id);
  const ids = new Set(nodes.map((node) => node.id));
  return nodes.map((node) => {
    const parentId = node.parentId && (sourceByDatabase.get(node.parentId) ?? node.parentId);
    return { ...node, parentId: parentId && parentId !== node.id && ids.has(parentId) ? parentId : null };
  });
}

/** Database rows newest first, like a table sorted by last edit; everything else by title. */
export function childrenByParent(nodes: readonly NotionNode[]): Map<string | null, NotionNode[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, NotionNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  for (const [parentId, list] of children) {
    if (parentId !== null && byId.get(parentId)?.kind === "database") {
      list.sort((a, b) => b.lastEdited.localeCompare(a.lastEdited));
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    }
  }
  return children;
}

export function visibleRows(
  children: ReadonlyMap<string | null, readonly NotionNode[]>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      const hasChildren = children.has(node.id);
      rows.push({ node, depth, hasChildren });
      // Depth cap guards against a parent cycle in shared data.
      if (hasChildren && expanded.has(node.id) && depth < 32) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function searchRows(nodes: readonly NotionNode[], query: string, limit = 200): TreeRow[] {
  const needle = query.trim().toLocaleLowerCase();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes
    .filter((node) => node.title.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.lastEdited.localeCompare(a.lastEdited))
    .slice(0, limit)
    .map((node) => ({
      node,
      depth: 0,
      hasChildren: false,
      path: node.parentId ? byId.get(node.parentId)?.title : undefined,
    }));
}

/** Root first, ending with the node itself. */
export function ancestry(byId: ReadonlyMap<string, NotionNode>, id: string): NotionNode[] {
  const chain: NotionNode[] = [];
  for (let node = byId.get(id); node && chain.length < 32; node = node.parentId ? byId.get(node.parentId) : undefined) {
    chain.unshift(node);
  }
  return chain;
}

/** Notion IDs appear dashed in the API and as 32 hex characters at the end of page URLs. */
export function notionIdFromUrl(url: string): string | null {
  // Links between pages inside rich text are often root-relative ("/<id>").
  if (!/^(https:\/\/([a-z0-9-]+\.)?notion\.(so|com|site))?\//i.test(url)) return null;
  const hex = /([0-9a-f]{32})(?:[?#]|$)/i.exec(url)?.[1];
  if (!hex) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
}

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

/** The list marker Notion draws at a nesting depth: 1. → a. → i. and • → ◦ → ▪. */
export function listMarker(numbered: boolean, n: number, depth: number): string {
  const level = depth % 3;
  if (!numbered) return ["•", "◦", "▪"][level];
  if (level === 0) return `${n}.`;
  let label = "";
  if (level === 1) for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) label = String.fromCharCode(97 + ((k - 1) % 26)) + label;
  else for (const [value, numeral] of ROMAN) for (; n >= value; n -= value) label += numeral;
  return `${label}.`;
}
