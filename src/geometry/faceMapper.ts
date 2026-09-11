import { FACE_DIRECTIONS } from '../domain/constants';
import type { FaceDirection, Vec3 } from '../domain/types';

export interface Box {
  from: Vec3;
  to: Vec3;
}

export interface BoxPair {
  /** Raw cube bounds as stored. */
  raw: Box;
  /** Bounds after Blockbench's inflate+stretch adjustment; what the rendered faces lie on. */
  inflated: Box;
}

const OPPOSITE_FACE: Record<FaceDirection, FaceDirection> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  up: 'down',
  down: 'up',
};

/**
 * Faces of a voxel that must not be rendered to keep the shell free of
 * coplanar duplicate surfaces (z-fighting):
 *
 * 1. the inner face (opposite the voxel's own direction) is always disabled -
 *    it is coplanar with the base cube's surface in preserve_layer mode and
 *    never legitimately visible;
 * 2. when the voxel's outer surface lies exactly on the inflated shell
 *    (depth == inflate), every other face is disabled as well: the six shell
 *    planes are covered exclusively by their owning direction's outer faces
 *    (exactly like the faces of the original inflated box), which seals the
 *    shell - any side face would be an interior duplicate of a face another
 *    direction also produces in the edge/corner overlap volumes. With other
 *    depth modes the shells separate, the sides become visible silhouette
 *    surfaces and are kept.
 */
export function resolveDisabledFaces(
  direction: FaceDirection,
  depthMatchesShell: boolean,
): FaceDirection[] {
  if (depthMatchesShell) {
    return FACE_DIRECTIONS.filter(face => face !== direction);
  }
  return [OPPOSITE_FACE[direction]];
}

/**
 * Port of Blockbench's `adjustFromAndToForInflateAndStretch`:
 * `from = center - (size/2 + inflate) * stretch`, `to = center + (size/2 + inflate) * stretch`.
 */
export function adjustedBox(from: Vec3, to: Vec3, inflate: number, stretch: Vec3): BoxPair {
  const inflatedFrom: Vec3 = [0, 0, 0];
  const inflatedTo: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const size = to[i] - from[i];
    const center = from[i] + size / 2;
    const half = (size / 2 + inflate) * stretch[i];
    inflatedFrom[i] = center - half;
    inflatedTo[i] = center + half;
  }
  return { raw: { from: [...from], to: [...to] }, inflated: { from: inflatedFrom, to: inflatedTo } };
}

export function faceNormal(direction: FaceDirection): Vec3 {
  switch (direction) {
    case 'north':
      return [0, 0, -1];
    case 'south':
      return [0, 0, 1];
    case 'east':
      return [1, 0, 0];
    case 'west':
      return [-1, 0, 0];
    case 'up':
      return [0, 1, 0];
    case 'down':
      return [0, -1, 0];
  }
}

/**
 * Spans of the inflated face rectangle along the two in-face axes, in the same
 * order as the grid's (cols, rows) = (model U, model V).
 *
 * The model axes follow Blockbench `CubeFace.UVToLocal` (rotation 0):
 *   north: U: x = lerp(to.x, from.x), V: y = lerp(to.y, from.y), plane z = from.z
 *   south: U: x = lerp(from.x, to.x), V: y = lerp(to.y, from.y), plane z = to.z
 *   east:  U: z = lerp(to.z, from.z), V: y = lerp(to.y, from.y), plane x = to.x
 *   west:  U: z = lerp(from.z, to.z), V: y = lerp(to.y, from.y), plane x = from.x
 *   up:    U: x = lerp(from.x, to.x), V: z = lerp(from.z, to.z), plane y = to.y
 *   down:  U: x = lerp(from.x, to.x), V: z = lerp(to.z, from.z), plane y = from.y
 */
export function faceSpans(direction: FaceDirection, box: BoxPair): { uSpan: number; vSpan: number } {
  const f = box.inflated.from;
  const t = box.inflated.to;
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Local coordinates of a point on the face, from the face parametrization
 * (mx, my) in [0,1]. Mirrors `CubeFace.UVToLocal` on the inflated box.
 */
export function facePoint(direction: FaceDirection, box: BoxPair, mx: number, my: number): Vec3 {
  const f = box.inflated.from;
  const t = box.inflated.to;
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
 * Axis-aligned voxel bounds for one grid cell.
 *
 * The in-face rectangle covers the cell on the inflated face; the thickness
 * anchors at the raw box surface and extends outward along the face normal, so
 * `depth = inflate` reproduces exactly the gap between the raw cube and the
 * original layer's outer surface.
 */
export function voxelBounds(
  direction: FaceDirection,
  box: BoxPair,
  mx0: number,
  mx1: number,
  my0: number,
  my1: number,
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
      return { from: [minX, minY, box.raw.from[2] - depth], to: [maxX, maxY, box.raw.from[2]] };
    case 'south':
      return { from: [minX, minY, box.raw.to[2]], to: [maxX, maxY, box.raw.to[2] + depth] };
    case 'east':
      return { from: [box.raw.to[0], minY, minZ], to: [box.raw.to[0] + depth, maxY, maxZ] };
    case 'west':
      return { from: [box.raw.from[0] - depth, minY, minZ], to: [box.raw.from[0], maxY, maxZ] };
    case 'up':
      return { from: [minX, box.raw.to[1], minZ], to: [maxX, box.raw.to[1] + depth, maxZ] };
    case 'down':
      return { from: [minX, box.raw.from[1] - depth, minZ], to: [maxX, box.raw.from[1], maxZ] };
  }
}
