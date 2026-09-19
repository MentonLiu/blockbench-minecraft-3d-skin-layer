export type FaceDirection = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

export type Vec3 = [number, number, number];

export type UVRect = [number, number, number, number];

/** 体素生成选项 / Voxel generation options. */
export interface GeneratorOptions {
  /** Alpha 阈值：alpha 高于该值的像素生成方块 / Texels with alpha above this become cubes. */
  alphaThreshold: number;
  /** 单次运行允许生成的最大体素数 / Preflight aborts above this count. */
  maxVoxels: number;
  /** 每批创建的方块数量（让出 UI 线程）/ Cubes created per UI batch. */
  batchSize: number;
  /** 为 true 时隐藏而非删除源层立方体 / Hide the sources instead of deleting them. */
  preserveOriginal: boolean;
  /** 为 true 时用空分组替换全透明层 / Replace fully transparent layers with empty groups. */
  replaceEmptyLayer: boolean;
  /** 项目打开时自动生成 / Generate automatically when a project loads. */
  autoApplyOnLoad: boolean;
  /** 仅处理被选中的层立方体 / Only process selected layer cubes. */
  processSelectedOnly: boolean;
  /** 实验开关：可用时用 Blockbench 的 UVToLocal 交叉验证 / Optional UVToLocal cross-check. */
  useUVToLocalWhenAvailable: boolean;
  /**
   * 修改目标：'current' 直接修改当前模型；'copy' 先复制出新模型再修改副本，
   * 原模型保持不变。复制仅在手动运行（有对话框）时生效。
   * Run target: 'current' modifies the open model; 'copy' duplicates the model
   * first and applies changes to the copy, leaving the original untouched.
   * Copying only applies to manual runs (dialog-based).
   */
  targetModel: 'current' | 'copy';
  /**
   * 为 true 时透明像素也生成方块（新建 3D 皮肤流程使用，先全量体素化，
   * 后续用"清除透明方块"清理）。默认 false：alpha 低于阈值的像素跳过。
   * When true, transparent pixels get cubes too (used by the new-skin flow:
   * voxelize everything first, clean up with "Clear Transparent Cubes").
   * Default false: texels at or below the alpha threshold are skipped.
   */
  includeTransparent: boolean;
}

export interface FaceSnapshot {
  direction: FaceDirection;
  enabled: boolean;
  /** 该面自己的纹理键（uuid）；null 表示没有纹理 / Key (uuid) of the face's own texture, or null. */
  textureKey: string | null;
  uv: UVRect;
  rotation: 0 | 90 | 180 | 270;
}

/** 一张纹理的已解码像素快照（不可变）/ Decoded, immutable pixel snapshot of one texture. */
export interface PixelSource {
  width: number;
  height: number;
  /** 项目对该纹理使用的 UV 空间尺寸 / UV coordinate space the project addresses this texture with. */
  uvWidth: number;
  uvHeight: number;
  /** RGBA 数据，每像素 4 字节，按行存储 / RGBA, 4 bytes per pixel, row-major. */
  rgba: Uint8ClampedArray;
}

/** 一个 `* Layer` 立方体的纯数据快照，包含规划所需的全部信息 / Plain-data capture of a `* Layer` cube. */
export interface LayerSnapshot {
  /** 运行时唯一键（立方体 uuid）/ Runtime-unique key (cube uuid). */
  key: string;
  name: string;
  from: Vec3;
  to: Vec3;
  inflate: number;
  stretch: Vec3;
  origin: Vec3;
  rotation: Vec3;
  visibility: boolean;
  /** 原 cube 的渲染属性，供还原操作精确重建 / Original cube render properties for exact restoration. */
  boxUV?: boolean;
  autouv?: 0 | 1 | 2;
  mirrorUV?: boolean;
  shade?: boolean;
  color?: number;
  rescale?: boolean;
  rotationAxis?: 'x' | 'y' | 'z';
  uvOffset?: [number, number];
  faces: FaceSnapshot[];
}

export interface TexelCell {
  direction: FaceDirection;
  /** 面网格上的行列索引 / Cell indices on the face grid. */
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** 采样到的图像像素 / Sampled image pixel. */
  imageX: number;
  imageY: number;
  alpha: number;
  /** 该 1 像素矩形的 UV 范围 / UV rectangle of exactly this image pixel. */
  pixelUV: UVRect;
}

export interface VoxelSpec {
  name: string;
  from: Vec3;
  to: Vec3;
  origin: Vec3;
  rotation: Vec3;
  textureKey: string;
  /** 源像素的 UV 矩形；六个面全部映射到它 / Source pixel rect; all six faces map to it. */
  pixelUV: UVRect;
  face: FaceDirection;
}

export interface LayerPlan {
  sourceKey: string;
  sourceName: string;
  /** 从源立方体复制给替换分组的枢轴 / Pivot copied from the source cube onto the replacement group. */
  origin: Vec3;
  voxels: VoxelSpec[];
  visiblePixelCount: number;
  visibility: boolean;
  /** 用于写入可还原元数据 / Original source data persisted on the generated group. */
  source: LayerSnapshot;
}

/** 生成组上保存的原始层数据 / Original layer data persisted on a generated group. */
export interface GeneratedLayerMetadata {
  schema: 1;
  source: LayerSnapshot;
}

/** 体素数超过 maxVoxels 时抛出的预检错误 / Preflight error when the plan exceeds maxVoxels. */
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
