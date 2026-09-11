import type { FaceDirection, Vec3 } from '../domain/types';

export interface Box {
  from: Vec3;
  to: Vec3;
}

/**
 * 层的面所渲染的膨胀盒：即 Blockbench 的
 * `adjustFromAndToForInflateAndStretch` —— 每个轴上
 * `from = 中心 - (尺寸/2 + inflate) * stretch`。
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

/** 把盒子每个侧面向内收缩 epsilon / Shrinks a box by `epsilon` on every side. */
export function insetBox(box: Box, epsilon: number): Box {
  return {
    from: [box.from[0] + epsilon, box.from[1] + epsilon, box.from[2] + epsilon],
    to: [box.to[0] - epsilon, box.to[1] - epsilon, box.to[2] - epsilon],
  };
}

/**
 * 面上一点的局部坐标：由面参数化 (mx, my) ∈ [0,1] 给出，
 * 与 Blockbench 的 `CubeFace.UVToLocal` 一致：
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
 * 面矩形沿两个面内轴的跨度，顺序与网格的 (cols, rows) = (模型 U, 模型 V) 一致
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
 * 一个网格单元的轴对齐体素边界。
 * Axis-aligned voxel bounds for one grid cell.
 *
 * 面内矩形切自 `faceBox`（按方向 epsilon 平移后的膨胀盒）。厚度板层锚定在
 * 原始盒表面并向外抬升 standoff、延伸 depth（层膨胀值 + 方向 epsilon），
 * 因此外表面落在原层表面 0.009 以内，同时每个方向的平面互不相同。
 * The in-face rectangle is cut from `faceBox` (the inflated box, translated by
 * the direction's epsilon). The slab anchors at the RAW box surface with a
 * tiny standoff and extends outward by `depth` (the layer inflate plus the
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
