import type { FaceDirection, Vec3 } from '../domain/types';

export interface Box {
  from: Vec3;
  to: Vec3;
}

/**
 * The inflated box the layer's faces render on: Blockbench's
 * `adjustFromAndToForInflateAndStretch` -
 * `from = center - (size/2 + inflate) * stretch` per axis.
 */
export function adjustedBox(from: Vec3, to: Vec3, inflate: number, stretch: Vec3): Box {
  const inflatedFrom: Vec3 = [0, 0, 0];
  const inflatedTo: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const size = to[i] - from[i];
    const center = from[i] + size / 2;
    const half = (size / 2 + inflate) * stretch[i];
    inflatedFrom[i] = center - half;
    inflatedTo[i] = center + half;
  }
  return { from: inflatedFrom, to: inflatedTo };
}

/** Shrinks a box by `epsilon` on every side. */
export function insetBox(box: Box, epsilon: number): Box {
  return {
    from: [box.from[0] + epsilon, box.from[1] + epsilon, box.from[2] + epsilon],
    to: [box.to[0] - epsilon, box.to[1] - epsilon, box.to[2] - epsilon],
  };
}

/**
 * Local coordinates of a point on the face, from the face parametrization
 * (mx, my) in [0,1]. Mirrors `CubeFace.UVToLocal`:
 *   north: U: x = lerp(to.x, from.x), V: y = lerp(to.y, from.y), plane z = from.z
 *   south: U: x = lerp(from.x, to.x), V: y = lerp(to.y, from.y), plane z = to.z
 *   east:  U: z = lerp(to.z, from.z), V: y = lerp(to.y, from.y), plane x = to.x
 *   west:  U: z = lerp(from.z, to.z), V: y = lerp(to.y, from.y), plane x = from.x
 *   up:    U: x = lerp(from.x, to.x), V: z = lerp(from.z, to.z), plane y = to.y
 *   down:  U: x = lerp(from.x, to.x), V: z = lerp(to.z, from.z), plane y = from.y
 */
function facePoint(direction: FaceDirection, box: Box, mx: number, my: number): Vec3 {
  const f = box.from;
  const t = box.to;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  switch (direction) {
    case 'north':
      return [lerp(t[0], f[0], mx), lerp(t[1], f[1], my), f[2]];
    case 'south':
      return [lerp(f[0], t[0], mx), lerp(t[1], f[1], my), t[2]];
    case 'east':
      return [t[0], lerp(t[1], f[1], my), lerp(t[2], f[2], mx)];
    case 'west':
      return [f[0], lerp(t[1], f[1], my), lerp(f[2], t[2], mx)];
    case 'up':
      return [lerp(f[0], t[0], mx), t[1], lerp(f[2], t[2], my)];
    case 'down':
      return [lerp(f[0], t[0], mx), f[1], lerp(t[2], f[2], my)];
  }
}

/**
 * Spans of the face rectangle along the two in-face axes, in the same order as
 * the grid's (cols, rows) = (model U, model V).
 */
export function faceSpans(direction: FaceDirection, box: Box): { uSpan: number; vSpan: number } {
  const f = box.from;
  const t = box.to;
  const width = t[0] - f[0];
  const height = t[1] - f[1];
  const depth = t[2] - f[2];
  switch (direction) {
    case 'north':
    case 'south':
      return { uSpan: width, vSpan: height };
    case 'east':
    case 'west':
      return { uSpan: depth, vSpan: height };
    case 'up':
    case 'down':
      return { uSpan: width, vSpan: depth };
  }
}

/**
 * Axis-aligned voxel bounds for one grid cell.
 *
 * The in-face rectangle is cut from `faceBox` (the inflated box, inset by the
 * direction's epsilon). The slab anchors at the RAW box surface with a tiny
 * standoff and extends outward by `depth` (the layer inflate plus the
 * direction's epsilon), so the voxel's outer surface lands within 0.009 of
 * the original layer surface while every direction's planes stay distinct.
 */
export function voxelBounds(
  direction: FaceDirection,
  faceBox: Box,
  rawFrom: Vec3,
  rawTo: Vec3,
  mx0: number,
  mx1: number,
  my0: number,
  my1: number,
  standoff: number,
  depth: number,
): { from: Vec3; to: Vec3 } {
  const a = facePoint(direction, faceBox, mx0, my0);
  const b = facePoint(direction, faceBox, mx1, my1);
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  const minZ = Math.min(a[2], b[2]);
  const maxZ = Math.max(a[2], b[2]);

  switch (direction) {
    case 'north':
      return { from: [minX, minY, rawFrom[2] - standoff - depth], to: [maxX, maxY, rawFrom[2] - standoff] };
    case 'south':
      return { from: [minX, minY, rawTo[2] + standoff], to: [maxX, maxY, rawTo[2] + standoff + depth] };
    case 'east':
      return { from: [rawTo[0] + standoff, minY, minZ], to: [rawTo[0] + standoff + depth, maxY, maxZ] };
    case 'west':
      return { from: [rawFrom[0] - standoff - depth, minY, minZ], to: [rawFrom[0] - standoff, maxY, maxZ] };
    case 'up':
      return { from: [minX, rawTo[1] + standoff, minZ], to: [maxX, rawTo[1] + standoff + depth, maxZ] };
    case 'down':
      return { from: [minX, rawFrom[1] - standoff - depth, minZ], to: [maxX, rawFrom[1] - standoff, maxZ] };
  }
}
