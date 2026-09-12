/*
 * One line, drawn one way.
 *
 * Every series on the customer surface is a monotone cubic through its own
 * points, the same curve recharts draws for `type="monotone"`. A straight
 * polyline through a week of days reads as a wire, and a single quiet day shows
 * as a kink rather than as the shape the week actually had.
 *
 * Monotone is the honest choice as well as the smooth one: the curve never
 * overshoots the value a day recorded, so smoothing cannot invent a peak or a
 * dip between two points. Hand-drawn SVG calls this; a recharts series states
 * `type="monotone"` and gets the identical shape.
 */

/** A point as it is drawn, in the caller's own units and SVG's y-down sense. */
export type LineVertex = readonly [x: number, y: number];

/** Two decimals is finer than any of these charts can show, and keeps the markup small. */
const round = (value: number) => Number(value.toFixed(2));

/**
 * The SVG path for a monotone cubic through `vertices`. Fewer than two points
 * draws nothing, because one point is not a trend.
 */
export function smoothLinePath(vertices: readonly LineVertex[]): string {
  if (vertices.length === 0) return "";
  const [firstX, firstY] = vertices[0];
  if (vertices.length === 1) return `M${round(firstX)},${round(firstY)}`;

  const tangents = monotoneTangents(vertices);
  let path = `M${round(firstX)},${round(firstY)}`;
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const [x0, y0] = vertices[index];
    const [x1, y1] = vertices[index + 1];
    // Handles a third of the way along the segment: the control points of the
    // same cubic d3-shape builds for curveMonotoneX.
    const third = (x1 - x0) / 3;
    path +=
      `C${round(x0 + third)},${round(y0 + tangents[index] * third)}` +
      ` ${round(x1 - third)},${round(y1 - tangents[index + 1] * third)}` +
      ` ${round(x1)},${round(y1)}`;
  }
  return path;
}

/**
 * Fritsch-Carlson tangents: the slopes that make the curve monotone between
 * every pair of points. A local peak or trough gets a flat tangent, and every
 * tangent is held inside the circle of radius three around the secants it
 * spans, which is what stops the curve from bulging past a recorded value.
 */
function monotoneTangents(vertices: readonly LineVertex[]): number[] {
  const count = vertices.length;
  const secants: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const run = vertices[index + 1][0] - vertices[index][0];
    secants.push(run === 0 ? 0 : (vertices[index + 1][1] - vertices[index][1]) / run);
  }

  const tangents = new Array<number>(count);
  tangents[0] = secants[0];
  tangents[count - 1] = secants[count - 2];
  for (let index = 1; index < count - 1; index += 1) {
    const before = secants[index - 1];
    const after = secants[index];
    tangents[index] = before * after <= 0 ? 0 : (before + after) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    const secant = secants[index];
    if (secant === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const alpha = tangents[index] / secant;
    const beta = tangents[index + 1] / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * alpha * secant;
      tangents[index + 1] = scale * beta * secant;
    }
  }

  return tangents;
}
