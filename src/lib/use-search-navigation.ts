'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useSearchNavigation
 * -------------------
 * Shared search-and-jump behaviour used by the Accounts page and the
 * Consolidated Salary page.
 *
 * Given a flat list of items (in DOM order), a stable id for each item,
 * and a match predicate, this hook exposes:
 *
 *  - `matchedIds`           — every item id whose row matches the current query
 *  - `currentIndex`         — 0-based index into matchedIds, or -1 if none
 *  - `currentMatchId`       — the id at currentIndex, or null
 *  - `registerRowRef(id, el)` — attach to each rendered row so the hook can
 *                              scrollIntoView the current match
 *  - `goToNext` / `goToPrev` — move forward / backward (wrap around)
 *  - `handleInputKeyDown`   — pass to the search <Input> onKeyDown; Enter
 *                              advances to the next match (wraps from last to
 *                              first), Shift+Enter goes to the previous match.
 *  - `isMatch(item)`        — true if the item matches the current query
 *  - `isCurrent(item)`      — true if the item is the currently focused match
 *  - `matchCount`           — total number of matches
 *
 * Whenever the query changes, the index resets to 0 (first match). Whenever
 * currentIndex changes, the corresponding row is scrolled into view (smooth,
 * centered) and `onCurrentMatchChange` is fired so the page can auto-expand
 * any collapsed branch / site that contains the match.
 *
 * The hook deliberately does NOT own the search query string — the page keeps
 * it in its own useState so it can also use it for filtering / display. Pass
 * it in as `query`.
 */
export interface UseSearchNavigationOptions<T> {
  /** Flat list of items in the same order they are rendered in the DOM. */
  items: T[];
  /** Stable id for each item — used as the row's React key and ref key. */
  getItemId: (item: T) => string;
  /** Returns true if the item matches the (already-lowercased) query. */
  matchItem: (item: T, queryLower: string) => boolean;
  /** Called whenever the current match changes (incl. null on clear). */
  onCurrentMatchChange?: (id: string | null) => void;
}

export interface UseSearchNavigationReturn<T> {
  matchedIds: string[];
  matchCount: number;
  currentIndex: number;
  currentMatchId: string | null;
  registerRowRef: (id: string, el: HTMLElement | null) => void;
  goToNext: () => void;
  goToPrev: () => void;
  handleInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  isMatch: (item: T) => boolean;
  isCurrent: (item: T) => boolean;
}

export function useSearchNavigation<T>(
  query: string,
  options: UseSearchNavigationOptions<T>,
): UseSearchNavigationReturn<T> {
  const { items, getItemId, matchItem, onCurrentMatchChange } = options;

  // All matching item ids, in DOM order.
  const queryLower = query.toLowerCase().trim();
  const matchedIds = useMemo(() => {
    if (!queryLower) return [];
    return items
      .filter((it) => matchItem(it, queryLower))
      .map((it) => getItemId(it));
  }, [items, queryLower, matchItem, getItemId]);

  const [currentIndex, setCurrentIndex] = useState(0);

  // CRITICAL: reset to the FIRST match whenever the query string itself
  // changes — even if the new match count happens to be the same as or
  // larger than the old one. Without this, typing a broader query (e.g.
  // going from "ab" with 3 matches to "a" with 10 matches) would leave
  // currentIndex at its old value (e.g. 2) and the user would land on a
  // non-first match — which they perceive as "jumps to the last entry".
  useEffect(() => {
    setCurrentIndex(queryLower ? 0 : -1);
  }, [queryLower]);

  // Safety clamp: if the items list changes underneath us (e.g. data was
  // refetched while a query is active) and currentIndex is now out of
  // bounds, snap it back into range. Tries to preserve the user's current
  // position when possible.
  useEffect(() => {
    setCurrentIndex((prev) => {
      if (matchedIds.length === 0) return -1;
      if (prev < 0 || prev >= matchedIds.length) return 0;
      return prev;
    });
  }, [matchedIds.length]);

  const currentMatchId =
    currentIndex >= 0 && currentIndex < matchedIds.length
      ? matchedIds[currentIndex]
      : null;

  // Store row element refs in a Map so we can scrollIntoView the current one.
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerRowRef = useCallback((id: string, el: HTMLElement | null) => {
    const map = rowRefs.current;
    if (el) {
      map.set(id, el);
    } else {
      map.delete(id);
    }
  }, []);

  // Notify the page whenever the current match changes.
  useEffect(() => {
    onCurrentMatchChange?.(currentMatchId);
    // We intentionally exclude onCurrentMatchChange from deps — the page
    // usually passes an inline callback and we don't want to refire on
    // every render. The hook only fires when the actual id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchId]);

  // Scroll the current match into view whenever it changes.
  // Use block: 'nearest' so we only scroll the minimum amount needed to bring
  // the row into view — matches Google Sheets behaviour, where pressing
  // next/prev only nudges the viewport enough to reveal the next match rather
  // than aggressively centering it.
  useEffect(() => {
    if (!currentMatchId) return;
    const el = rowRefs.current.get(currentMatchId);
    if (!el) return;
    // Defer one frame so any auto-expand setState has time to render the row
    // before we try to scroll to it (otherwise the row may still be hidden
    // inside a collapsed section and scrollIntoView will be a no-op).
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [currentMatchId]);

  const goToNext = useCallback(() => {
    if (matchedIds.length === 0) return;
    setCurrentIndex((prev) =>
      prev < 0 || prev >= matchedIds.length - 1 ? 0 : prev + 1,
    );
  }, [matchedIds.length]);

  const goToPrev = useCallback(() => {
    if (matchedIds.length === 0) return;
    setCurrentIndex((prev) =>
      prev <= 0 ? matchedIds.length - 1 : prev - 1,
    );
  }, [matchedIds.length]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (matchedIds.length === 0) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrev();
        } else {
          goToNext();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goToPrev();
      }
    },
    [matchedIds.length, goToNext, goToPrev],
  );

  // Build a Set of matched ids for O(1) lookup in render hot path.
  const matchedSet = useMemo(() => new Set(matchedIds), [matchedIds]);

  const isMatch = useCallback(
    (item: T) => matchedSet.has(getItemId(item)),
    [matchedSet, getItemId],
  );

  const isCurrent = useCallback(
    (item: T) => currentMatchId !== null && getItemId(item) === currentMatchId,
    [currentMatchId, getItemId],
  );

  return {
    matchedIds,
    matchCount: matchedIds.length,
    currentIndex,
    currentMatchId,
    registerRowRef,
    goToNext,
    goToPrev,
    handleInputKeyDown,
    isMatch,
    isCurrent,
  };
}
