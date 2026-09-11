import type { FaceDirection, GeneratorOptions } from './types';

export const PLUGIN_ID = 'minecraft_3d_skin_layers';

/** Matches "Hat Layer", "body layer"; rejects "MyLayer", "Layer Helper", "LayerExtra". */
export const LAYER_NAME_RE = /\sLayer$/i;

export const FACE_DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west', 'up', 'down'];

export const DEFAULT_OPTIONS: GeneratorOptions = {
  alphaThreshold: 0,
  maxVoxels: 10_000,
  batchSize: 200,
  preserveOriginal: false,
  replaceEmptyLayer: false,
  autoApplyOnLoad: false,
  processSelectedOnly: false,
  useUVToLocalWhenAvailable: false,
};

/** Voxels are lifted this far off the raw surface, so no inner face is
 * coplanar with the base cube's own faces (same-part z-fighting). */
export const VOXEL_STANDOFF = 0.001;

/**
 * Per-direction epsilon that separates the six voxel shells of one part: each
 * direction grids and protrudes a tiny bit more than the previous one, so
 * faces of different directions never land on the same plane (the corner and
 * slit overlaps of the inflated shell). Max offset: 5 * step = 0.0075 -
 * imperceptible, but enough for the depth buffer.
 */
export const FACE_EPSILON_STEP = 0.0015;

/** Tolerance when checking that a face UV spans whole texels. */
export const TEXEL_EPSILON = 0.01;
