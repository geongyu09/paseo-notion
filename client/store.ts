import { useSyncExternalStore } from "react";

/** A page and the workspace whose token reads it (see `space` in shared/notion.ts). */
export interface Spot {
  space: string | null;
  id: string;
}

/** What the page tab of one workspace shows, with the pages to go back to. */
export interface Place extends Spot {
  back: readonly Spot[];
}

const places = new Map<string, Place>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** `from` seeds the back stack when the tab was restored from saved state. */
export function navigate(workspaceId: string, to: Spot, from?: Spot | null) {
  const current = places.get(workspaceId);
  if ((current ?? from)?.id === to.id) return;
  const back = current ? [...current.back, { space: current.space, id: current.id }] : from ? [from] : [];
  places.set(workspaceId, { space: to.space, id: to.id, back: back.slice(-50) });
  emit();
}

/** Seeds the place from a restored tab so the Explorer can highlight it, without adding history. */
export function restore(workspaceId: string, spot: Spot) {
  if (places.has(workspaceId)) return;
  places.set(workspaceId, { space: spot.space, id: spot.id, back: [] });
  emit();
}

export function goBack(workspaceId: string) {
  const current = places.get(workspaceId);
  const previous = current?.back.at(-1);
  if (!current || !previous) return;
  places.set(workspaceId, { ...previous, back: current.back.slice(0, -1) });
  emit();
}

export function usePlace(workspaceId: string): Place | undefined {
  return useSyncExternalStore(subscribe, () => places.get(workspaceId));
}
