export type FaceDirection = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

export type Vec3 = [number, number, number];

export type UVRect = [number, number, number, number];

export interface GeneratorOptions {
  alphaThreshold: number;
  maxVoxels: number;
  batchSize: number;
  preserveOriginal: boolean;
  replaceEmptyLayer: boolean;
  autoApplyOnLoad: boolean;
  processSelectedOnly: boolean;
  useUVToLocalWhenAvailable: boolean;
}

/** Decoded, immutable pixel snapshot of one texture. */
export interface PixelSource {
  width: number;
  height: number;
  /** UV coordinate space the project addresses this texture with. */
  uvWidth: number;
  uvHeight: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  rgba: Uint8ClampedArray;
}

export interface FaceSnapshot {
  direction: FaceDirection;
  enabled: boolean;
  /** Key (uuid) of the face's own texture, or null when the face has none. */
  textureKey: string | null;
  uv: UVRect;
  rotation: 0 | 90 | 180 | 270;
}

/** Plain-data capture of a `* Layer` cube; everything the planner needs. */
export interface LayerSnapshot {
  /** Runtime-unique key (cube uuid). */
  key: string;
  name: string;
  from: Vec3;
  to: Vec3;
  inflate: number;
  stretch: Vec3;
  origin: Vec3;
  rotation: Vec3;
  visibility: boolean;
  faces: FaceSnapshot[];
}

export interface TexelCell {
  direction: FaceDirection;
  /** Cell indices on the face grid (col along the face's U-model axis, row along V). */
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** Sampled image pixel. */
  imageX: number;
  imageY: number;
  alpha: number;
  /** UV rectangle of exactly this image pixel in UV units. */
  pixelUV: UVRect;
}

export interface VoxelSpec {
  name: string;
  from: Vec3;
  to: Vec3;
  origin: Vec3;
  rotation: Vec3;
  textureKey: string;
  /** UV rectangle of the source pixel; all six faces map to it. */
  pixelUV: UVRect;
  face: FaceDirection;
}

export interface LayerPlan {
  sourceKey: string;
  sourceName: string;
  /** Pivot copied from the source cube onto the replacement group. */
  origin: Vec3;
  voxels: VoxelSpec[];
  visiblePixelCount: number;
  visibility: boolean;
}

export class VoxelLimitError extends Error {
  constructor(public readonly voxelCount: number, public readonly limit: number) {
    super(`Voxel plan needs ${voxelCount} cubes which exceeds maxVoxels (${limit}).`);
    this.name = 'VoxelLimitError';
  }
}

export interface GenerationResult {
  createdCubes: number;
  createdGroups: number;
  durationMs: number;
}
