import type { FaceDirection, GeneratorOptions } from './types';

export const PLUGIN_ID = 'minecraft_3d_skin_layers';

/** Matches "Hat Layer", "body layer"; rejects "MyLayer", "Layer Helper", "LayerExtra". */
export const LAYER_NAME_RE = /\sLayer$/i;

export const FACE_DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west', 'up', 'down'];

export const DEFAULT_OPTIONS: GeneratorOptions = {
  alphaThreshold: 0,
  maxVoxels: 10_000,
  batchSize: 200,
  depthMode: 'preserve_layer',
  fixedDepth: 0.25,
  preserveOriginal: false,
  replaceEmptyLayer: false,
  autoApplyOnLoad: false,
  processSelectedOnly: false,
  useUVToLocalWhenAvailable: false,
};

/** Tolerance when checking that a face UV spans whole texels. */
export const TEXEL_EPSILON = 0.01;

/** Voxels thinner than this would be degenerate cubes. */
export const MIN_DEPTH = 0.01;
