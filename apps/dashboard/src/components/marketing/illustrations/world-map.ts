/**
 * A coarse world map on a 6-degree grid (60 columns x 22 rows, 72N to 54S),
 * stored as land runs per row: [row, firstColumn, lastColumn]. Rendered as
 * rectangles filled with a dot pattern, which gives the familiar dotted-map
 * look without shipping a geography dataset.
 */
export const MAP_WIDTH = 600;
export const MAP_HEIGHT = 220;
const CELL = 10;

export const LAND_RUNS: Array<[number, number, number]> = [
  [0, 9, 17], [0, 20, 26], [0, 39, 39], [0, 41, 53],
  [1, 2, 19], [1, 21, 24], [1, 26, 26], [1, 32, 59],
  [2, 3, 13], [2, 16, 19], [2, 22, 22], [2, 30, 57],
  [3, 8, 14], [3, 17, 20], [3, 29, 29], [3, 31, 53], [3, 56, 56],
  [4, 9, 19], [4, 29, 52],
  [5, 9, 18], [5, 28, 33], [5, 37, 51], [5, 53, 53],
  [6, 10, 17], [6, 29, 31], [6, 33, 50], [6, 51, 51], [6, 53, 53],
  [7, 10, 16], [7, 28, 50],
  [8, 11, 13], [8, 16, 16], [8, 27, 50],
  [9, 13, 15], [9, 27, 38], [9, 42, 44], [9, 46, 48], [9, 50, 50],
  [10, 15, 15], [10, 18, 19], [10, 27, 38], [10, 42, 43], [10, 46, 48], [10, 50, 50],
  [11, 17, 21], [11, 28, 38], [11, 43, 43], [11, 46, 47], [11, 49, 50],
  [12, 16, 21], [12, 31, 37], [12, 46, 51],
  [13, 16, 24], [13, 32, 36], [13, 47, 55],
  [14, 17, 23], [14, 32, 36], [14, 51, 53],
  [15, 18, 23], [15, 32, 35], [15, 37, 37], [15, 50, 54],
  [16, 18, 22], [16, 32, 35], [16, 37, 37], [16, 49, 55],
  [17, 18, 21], [17, 32, 35], [17, 49, 55],
  [18, 18, 20], [18, 49, 49], [18, 53, 54], [18, 59, 59],
  [19, 18, 19], [19, 54, 54], [19, 58, 58],
  [20, 17, 18],
  [21, 18, 18],
];

export function landRects() {
  return LAND_RUNS.map(([row, from, to]) => ({
    x: from * CELL,
    y: row * CELL,
    width: (to - from + 1) * CELL,
    height: CELL,
  }));
}

/** Longitude/latitude to map coordinates. */
export function project(lon: number, lat: number) {
  return { x: ((lon + 180) / 6) * CELL, y: ((72 - lat) / 6) * CELL + CELL / 2 };
}
