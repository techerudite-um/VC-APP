"use client";

/**
 * Same behavior as LiveKit `GridLayout`, but passes custom `gridLayouts` into
 * `useGridLayout` (the stock component does not expose this).
 *
 * Pagination UI mirrors @livekit/components-react GridLayout (Apache-2.0, LiveKit).
 */

import * as React from "react";
import {
  createInteractingObservable,
  sortTrackReferences,
  type GridLayoutDefinition,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import { TrackLoop, useGridLayout, useSwipe } from "@livekit/components-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVEMEET_GRID_LAYOUTS } from "@/lib/livemeet-grid-layouts";

/**
 * Pagination without `useVisualStableUpdate` / `updatePages`. Those can throw when a
 * camera placeholder is replaced by a real track (`admin_camera_placeholder` →
 * `admin_camera_TR_…`) while the stable list is mid-reconcile.
 */
function useSortedPagination(
  itemPerPage: number,
  trackReferences: TrackReferenceOrPlaceholder[],
) {
  const sortedTrackRefs = React.useMemo(
    () => sortTrackReferences(trackReferences),
    [trackReferences],
  );
  const safeItemPerPage = Math.max(1, itemPerPage);
  const totalPageCount = Math.max(1, Math.ceil(sortedTrackRefs.length / safeItemPerPage));

  const [currentPage, setCurrentPage] = React.useState(1);

  React.useEffect(() => {
    setCurrentPage((p) => Math.min(p, totalPageCount));
  }, [totalPageCount]);

  const clampedPage = Math.min(currentPage, totalPageCount);
  const lastItemIndex = clampedPage * safeItemPerPage;
  const firstItemIndex = lastItemIndex - safeItemPerPage;
  const tracksOnPage = sortedTrackRefs.slice(firstItemIndex, lastItemIndex);

  const changePage = React.useCallback(
    (direction: "next" | "previous") => {
      setCurrentPage((state) => {
        const pages = Math.max(1, Math.ceil(sortedTrackRefs.length / safeItemPerPage));
        if (direction === "next") {
          return state >= pages ? state : state + 1;
        }
        return state <= 1 ? 1 : state - 1;
      });
    },
    [sortedTrackRefs.length, safeItemPerPage],
  );

  const goToPage = React.useCallback(
    (num: number) => {
      const pages = Math.max(1, Math.ceil(sortedTrackRefs.length / safeItemPerPage));
      if (num > pages) {
        setCurrentPage(pages);
      } else if (num < 1) {
        setCurrentPage(1);
      } else {
        setCurrentPage(num);
      }
    },
    [sortedTrackRefs.length, safeItemPerPage],
  );

  return {
    totalPageCount,
    nextPage: () => changePage("next"),
    prevPage: () => changePage("previous"),
    setPage: goToPage,
    firstItemIndex,
    lastItemIndex,
    tracks: tracksOnPage,
    currentPage: clampedPage,
  };
}

export type LiveMeetGridLayoutProps = React.ComponentProps<"div"> & {
  tracks: TrackReferenceOrPlaceholder[];
  /** Defaults to {@link LIVEMEET_GRID_LAYOUTS} */
  gridLayouts?: GridLayoutDefinition[];
};

export function LiveMeetGridLayout({
  tracks,
  gridLayouts = LIVEMEET_GRID_LAYOUTS,
  className,
  children,
  ...rest
}: LiveMeetGridLayoutProps) {
  const gridEl = React.useRef<HTMLDivElement>(null);
  /** LiveKit hook typings expect `RefObject<HTMLDivElement>` (no null in type param). */
  const gridLayoutEl = gridEl as React.RefObject<HTMLDivElement>;
  const { layout } = useGridLayout(gridLayoutEl, tracks.length, { gridLayouts });
  const pagination = useSortedPagination(layout.maxTiles, tracks);

  useSwipe(gridLayoutEl as React.RefObject<HTMLElement>, {
    onLeftSwipe: pagination.nextPage,
    onRightSwipe: pagination.prevPage,
  });

  const [interactive, setInteractive] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = gridEl.current;
    if (!el) return;
    const sub = createInteractingObservable(el, 2000).subscribe(setInteractive);
    return () => sub.unsubscribe();
  }, []);

  const indicator = Array.from({ length: pagination.totalPageCount }, (_, i) =>
    i + 1 === pagination.currentPage ? (
      <span key={i} data-lk-active />
    ) : (
      <span key={i} />
    ),
  );

  return (
    <div
      ref={gridEl}
      data-lk-pagination={pagination.totalPageCount > 1}
      className={cn("lk-grid-layout", className)}
      {...rest}
    >
      <TrackLoop tracks={pagination.tracks}>{children}</TrackLoop>
      {tracks.length > layout.maxTiles && (
        <>
          <div className="lk-pagination-indicator">{indicator}</div>
          <div className="lk-pagination-control" data-lk-user-interaction={interactive}>
            <button type="button" className="lk-button" onClick={pagination.prevPage} aria-label="Previous page">
              <ChevronLeft className="size-4" strokeWidth={2} />
            </button>
            <span className="lk-pagination-count">
              {pagination.currentPage} of {pagination.totalPageCount}
            </span>
            <button type="button" className="lk-button" onClick={pagination.nextPage} aria-label="Next page">
              <ChevronRight className="size-4" strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
