import type { FaceDirection, Vec3 } from '../domain/types';

export interface Box {
  from: Vec3;
  to: Vec3;
}

/**
 * Local coordinates of a point on the face, from the face parametrization
 * (mx, my) in [0,1]. Mirrors `CubeFace.UVToLocal` on the raw box:
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
 * The in-face rectangle tiles the RAW box face (not the inflated one), so
 * slabs belonging to different face directions never overlap and can never
 * produce coplanar duplicate surfaces. `standoff` lifts the slab a tiny bit
 * off the raw surface - it separates the voxel inner faces from the base
 * cube's faces and, with a per-layer offset, keeps interpenetrating source
 * cubes (overlapping legs) from flickering. `depth` is the thickness along
 * the face normal.
 */
export function voxelBounds(
  direction: FaceDirection,
  box: Box,
  mx0: number,
  mx1: number,
  my0: number,
  my1: number,
  standoff: number,
  depth: number,
): { from: Vec3; to: Vec3 } {
  const a = facePoint(direction, box, mx0, my0);
  const b = facePoint(direction, box, mx1, my1);
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  const minZ = Math.min(a[2], b[2]);
  const maxZ = Math.max(a[2], b[2]);

  switch (direction) {
    case 'north':
      return { from: [minX, minY, box.from[2] - standoff - depth], to: [maxX, maxY, box.from[2] - standoff] };
    case 'south':
      return { from: [minX, minY, box.to[2] + standoff], to: [maxX, maxY, box.to[2] + standoff + depth] };
    case 'east':
      return { from: [box.to[0] + standoff, minY, minZ], to: [box.to[0] + standoff + depth, maxY, maxZ] };
    case 'west':
      return { from: [box.from[0] - standoff - depth, minY, minZ], to: [box.from[0] - standoff, maxY, maxZ] };
    case 'up':
      return { from: [minX, box.to[1] + standoff, minZ], to: [maxX, box.to[1] + standoff + depth, maxZ] };
    case 'down':
      return { from: [minX, box.from[1] - standoff - depth, minZ], to: [maxX, box.from[1] - standoff, maxZ] };
  }
}

/**
 * Box UV offset (uv_offset) that puts the voxel's shell face exactly on its
 * source pixel. The box unwrap of a cube (w, h, d) samples these rects:
 *   east [ox, oy+d], north [ox+d, oy+d], west [ox+d+w, oy+d],
 *   south [ox+2d+w, oy+d], up [ox+d, oy], down [ox+d+w, oy]
 */
export function boxUvOffset(
  direction: FaceDirection,
  pixelU: number,
  pixelV: number,
  w: number,
  d: number,
): [number, number] {
  switch (direction) {
    case 'north':
      return [pixelU - d, pixelV - d];
    case 'south':
      return [pixelU - 2 * d - w, pixelV - d];
    case 'west':
      return [pixelU - d - w, pixelV - d];
    case 'east':
      return [pixelU, pixelV - d];
    case 'up':
      return [pixelU - d, pixelV];
    case 'down':
      return [pixelU - d - w, pixelV];
  }
}
