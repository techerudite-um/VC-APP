import type { GridLayoutDefinition } from "@livekit/components-core";

/**
 * Gallery layouts for LiveMeet. `minWidth` / `minHeight` must be high enough that each
 * column has a sensible width (~≥280px); otherwise LiveKit picks 3×2 on a ~600px-wide
 * window and tiles become tall “phone pillar” strips (bad web UX).
 *
 * Based on GRID_LAYOUTS from @livekit/components-core (Apache-2.0).
 */
export const LIVEMEET_GRID_LAYOUTS: GridLayoutDefinition[] = [
  { columns: 1, rows: 1 },
  { columns: 1, rows: 2, orientation: "portrait" },
  { columns: 2, rows: 1, orientation: "landscape" },
  { columns: 2, rows: 2, minWidth: 640, minHeight: 360 },
  { columns: 2, rows: 3, orientation: "portrait", minWidth: 420, minHeight: 640 },
  { columns: 3, rows: 2, minWidth: 960, minHeight: 400 },
  { columns: 3, rows: 3, minWidth: 1120, minHeight: 520 },
  { columns: 4, rows: 3, minWidth: 1280, minHeight: 520 },
  { columns: 4, rows: 4, minWidth: 1400, minHeight: 620 },
  { columns: 5, rows: 5, minWidth: 1520, minHeight: 720 },
];
