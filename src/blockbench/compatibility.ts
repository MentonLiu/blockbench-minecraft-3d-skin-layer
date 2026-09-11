import { FACE_DIRECTIONS } from '../domain/constants';
import type {
  FaceSnapshot,
  LayerSnapshot,
  PixelSource,
  UVRect,
  Vec3,
} from '../domain/types';
import { findLayerCubes } from '../scan/layerScanner';
import type { GeneratorOptions } from '../domain/types';

/** 把运行时数组补齐为三元 Vec3，缺失位以 fill 填充 / Pad an array into a Vec3. */
function asVec3(value: readonly number[] | undefined, fill: number): Vec3 {
  return [
    typeof value?.[0] === 'number' ? value[0] : fill,
    typeof value?.[1] === 'number' ? value[1] : fill,
    typeof value?.[2] === 'number' ? value[2] : fill,
  ];
}

/** 把旋转值归一化到 0/90/180/270 / Normalize a rotation to 0/90/180/270. */
function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const step = ((Math.round((value ?? 0) / 90) * 90) % 360 + 360) % 360;
  return (step === 90 || step === 180 || step === 270 ? step : 0) as 0 | 90 | 180 | 270;
}

/**
 * 提取面的纹理键：null 表示该面被禁用或没有纹理。
 * Blockbench 中 texture === null 表示该面不存在（不渲染）。
 * Extract the texture key of a face: null means disabled or untextured.
 * In Blockbench, texture === null means the face does not exist (not rendered).
 */
function faceTextureKey(face: CubeFace): string | null {
  const texture: unknown = face.texture;
  if (texture === null || texture === undefined || texture === false) {
    return null;
  }
  if (typeof texture === 'string') {
    return texture;
  }
  if (typeof texture === 'object' && texture !== null && 'uuid' in texture) {
    return String((texture as { uuid: unknown }).uuid);
  }
  return null;
}

/** 从活动立方体捕获体素规划器需要的全部数据 / Captures everything the planner needs from a live cube. */
export function snapshotLayerCube(cube: Cube): LayerSnapshot {
  const faces: FaceSnapshot[] = [];
  for (const direction of FACE_DIRECTIONS) {
    const face = cube.faces[direction];
    if (!face) {
      continue;
    }
    faces.push({
      direction,
      // texture === null 的面不参与渲染 / a face with texture === null does not exist for rendering
      enabled: face.texture !== null,
      textureKey: faceTextureKey(face),
      uv: [face.uv[0], face.uv[1], face.uv[2], face.uv[3]] as UVRect,
      rotation: normalizeRotation(face.rotation),
    });
  }
  return {
    key: cube.uuid,
    name: cube.name,
    from: asVec3(cube.from, 0),
    to: asVec3(cube.to, 0),
    inflate: typeof cube.inflate === 'number' ? cube.inflate : 0,
    stretch: asVec3(cube.stretch, 1),
    origin: asVec3(cube.origin, 0),
    rotation: asVec3(cube.rotation, 0),
    visibility: cube.visibility !== false,
    faces,
  };
}

export function collectLayerSnapshots(options: GeneratorOptions): LayerSnapshot[] {
  const cubes = findLayerCubes(Cube.all);
  const selected = options.processSelectedOnly
    ? cubes.filter(cube => cube.selected === true)
    : cubes;
  return selected.map(snapshotLayerCube);
}

export function resolveTextureByKey(key: string): Texture | undefined {
  return Texture.all.find(texture => texture.uuid === key);
}

/**
 * 把纹理解码为纯像素快照。4.9 起，内部模式的纹理画布是唯一数据源；
 * 每张纹理只调用一次 getImageData，让热点循环完全摆脱画布访问。
 * Decodes a texture into a plain pixel snapshot. The texture canvas is the
 * source of truth for internal textures since 4.9; one getImageData call per
 * texture keeps the hot loops free of canvas access.
 */
export function textureToPixelSource(texture: Texture): PixelSource {
  const canvas = texture.canvas;
  if (!canvas) {
    throw new Error(`Texture "${texture.name}" has no canvas to read pixels from`);
  }
  const width = Math.max(1, Math.round(texture.width || canvas.width));
  const height = Math.max(1, Math.round(texture.height || canvas.height));
  const context = texture.ctx ?? canvas.getContext('2d');
  if (!context) {
    throw new Error(`Texture "${texture.name}" exposes no 2d context`);
  }
  const image = context.getImageData(0, 0, width, height);

  const uvWidth =
    typeof texture.getUVWidth === 'function' ? texture.getUVWidth() : texture.uv_width ?? width;
  const uvHeight =
    typeof texture.getUVHeight === 'function' ? texture.getUVHeight() : texture.uv_height ?? height;

  return {
    width,
    height,
    uvWidth: Math.max(1, uvWidth),
    uvHeight: Math.max(1, uvHeight),
    rgba: image.data,
  };
}

/** 把快照引用到的每张纹理各解码一次 / Decodes every referenced texture once. */
export function buildTextureMap(
  snapshots: readonly LayerSnapshot[],
): { textures: Map<string, PixelSource>; warnings: string[] } {
  const warnings: string[] = [];
  const textures = new Map<string, PixelSource>();
  for (const snapshot of snapshots) {
    for (const face of snapshot.faces) {
      if (!face.enabled || face.textureKey === null || textures.has(face.textureKey)) {
        continue;
      }
      const texture = resolveTextureByKey(face.textureKey);
      if (!texture) {
        warnings.push(`${snapshot.name}: face texture ${face.textureKey} is not loaded`);
        continue;
      }
      try {
        textures.set(face.textureKey, textureToPixelSource(texture));
      } catch (error) {
        warnings.push(`${snapshot.name}: failed to read texture pixels (${String(error)})`);
      }
    }
  }
  return { textures, warnings };
}

/** 当前是否处于编辑模式 / Whether Edit mode is active. */
export function isEditMode(): boolean {
  return typeof Modes === 'object' && Modes.edit === true;
}

/** 是否有已打开的项目 / Whether a project is open. */
export function hasOpenProject(): boolean {
  return typeof Project !== 'undefined' && !!Project;
}

export type ProjectListener = () => void;

/** 注册一个可在卸载时销毁的 Blockbench 事件监听 / Register a disposable Blockbench event listener. */
export function onProjectEvent(event: 'load_project' | 'select_project', listener: ProjectListener): { dispose(): void } {
  const handle = Blockbench.on(event, () => listener());
  return {
    dispose() {
      if (typeof handle?.delete === 'function') {
        handle.delete();
      }
    },
  };
}
