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
  type GridLayoutDefinition,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import {
  TrackLoop,
  useGridLayout,
  usePagination,
  useSwipe,
} from "@livekit/components-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVEMEET_GRID_LAYOUTS } from "@/lib/livemeet-grid-layouts";

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
  const gridEl = React.createRef<HTMLDivElement>();
  const { layout } = useGridLayout(gridEl, tracks.length, { gridLayouts });
  const pagination = usePagination(layout.maxTiles, tracks);

  useSwipe(gridEl, {
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
