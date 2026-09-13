import type { FaceDirection, GeneratorOptions } from './types';

export const PLUGIN_ID = 'minecraft_3d_skin_layers';

/**
 * 层名称匹配规则：匹配 "Hat Layer"、"body layer"，以及分段模板的
 * 数字后缀命名 "Body Layer1"、"Right Arm Layer2"；
 * 拒绝 "MyLayer1"、"Layer Helper"、"LayerExtra"、"Hat Layer Group"。
 * Matches "Hat Layer", "body layer", plus the digit-suffixed segment names
 * used by jointed templates ("Body Layer1", "Right Arm Layer2"); rejects
 * "MyLayer1", "Layer Helper", "LayerExtra", "Hat Layer Group".
 */
export const LAYER_NAME_RE = /\sLayer\d*$/i;

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

/** 体素抬离原始表面的距离（同部位防共面闪烁）/ Lift of the voxels off the raw surface. */
export const VOXEL_STANDOFF = 0.001;

/**
 * 每个方向的 epsilon：让六个方向的外壳彼此错开，
 * 消除同部位内的共面重叠（最大偏移 0.0075，视觉不可见）。
 * Per-direction epsilon that separates the six shells of one part
 * (max offset 5 * step = 0.0075 - imperceptible).
 */
export const FACE_EPSILON_STEP = 0.0015;

/** 校验面 UV 是否横跨整数纹理像素时的容差 / Tolerance for whole-texel UV span checks. */
export const TEXEL_EPSILON = 0.01;
