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

/** Tolerance when checking that a face UV spans whole texels. */
export const TEXEL_EPSILON = 0.01;
