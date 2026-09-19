import { GENERATED_SOURCE_PROPERTY } from '../domain/constants';
import type { PixelSource, UVRect } from '../domain/types';
import { getAlpha, textureScales } from '../texture/pixelReader';
import { faceTextureKey, resolveTextureByKey, textureToPixelSource } from './compatibility';
import type { WriterHost } from './modelWriter';

export interface VoxelPixelRef {
  /** 活动的体素方块 / The live voxel cube. */
  cube: unknown;
  name: string;
  /** 六面共同映射的源像素矩形 / The source pixel rect shared by all six faces. */
  pixelUV: UVRect;
  textureKey: string | null;
}

export interface TransparentRemovalPlan {
  removable: VoxelPixelRef[];
  keptCount: number;
  warnings: string[];
}

export interface ClearSummary {
  removed: number;
  warnings: readonly string[];
}

/** 面的 UV 是否恰好覆盖一个纹理像素 / Whether the face UV spans exactly one texel. */
export function isSingleTexelUV(pixelUV: UVRect, texture: PixelSource): boolean {
  const { sx, sy } = textureScales(texture);
  const width = Math.abs(pixelUV[2] - pixelUV[0]) * sx;
  const height = Math.abs(pixelUV[3] - pixelUV[1]) * sy;
  return Math.abs(width - 1) < 0.01 && Math.abs(height - 1) < 0.01;
}

/**
 * 纯规划：按采样像素的 alpha 找出应当移除的体素。UV 不是单像素矩形、
 * 纹理缺失或坐标越界的方块一律保留并上报，绝不误删。
 * Pure planner: finds the voxels to remove by their sampled pixel's alpha.
 * Cubes whose UV is not a single texel, whose texture is missing, or whose
 * sample lands outside the texture are always kept and reported.
 */
export function planTransparentRemovals(
  items: readonly VoxelPixelRef[],
  textures: ReadonlyMap<string, PixelSource>,
  alphaThreshold: number,
): TransparentRemovalPlan {
  const warnings: string[] = [];
  const removable: VoxelPixelRef[] = [];
  let keptCount = 0;
  for (const item of items) {
    const texture = item.textureKey !== null ? textures.get(item.textureKey) : undefined;
    if (!texture) {
      warnings.push(`${item.name}: texture not readable, cube kept`);
      keptCount++;
      continue;
    }
    if (!isSingleTexelUV(item.pixelUV, texture)) {
      warnings.push(`${item.name}: face UV is not a single texel, cube kept`);
      keptCount++;
      continue;
    }
    const { sx, sy } = textureScales(texture);
    const x = Math.round(item.pixelUV[0] * sx);
    const y = Math.round(item.pixelUV[1] * sy);
    if (x < 0 || y < 0 || x >= texture.width || y >= texture.height) {
      warnings.push(`${item.name}: sample (${x}, ${y}) is outside the texture, cube kept`);
      keptCount++;
      continue;
    }
    const alpha = getAlpha(texture, x, y);
    if (alpha <= alphaThreshold) {
      removable.push(item);
    } else {
      keptCount++;
    }
  }
  return { removable, keptCount, warnings };
}

/**
 * 收集当前项目中体素方块的像素引用。来源是带 m3sl_source 元数据的分组，
 * 以及兼容 0.3.1 之前版本的同名层分组；单个方块的 UV 必须是单像素矩形
 * 才参与清除（在规划器中校验）。
 * Collects the pixel references of every voxel cube in the project. Sources
 * are groups carrying the m3sl_source metadata plus legacy same-named layer
 * groups from before 0.3.1; a cube only participates when its UV is a single
 * texel (validated in the planner).
 */
export function collectVoxelPixelRefs(): VoxelPixelRef[] {
  if (typeof Group === 'undefined') {
    return [];
  }
  const refs: VoxelPixelRef[] = [];
  const groups = Group.all.filter(group => {
    const metadata = (group as unknown as Record<string, unknown>)[GENERATED_SOURCE_PROPERTY];
    return metadata !== null && metadata !== undefined;
  });
  for (const group of groups) {
    for (const child of group.children) {
      const cube = child as Cube;
      if (!cube || !cube.faces || cube.type !== 'cube') {
        continue;
      }
      const face = cube.faces.north ?? cube.faces.south ?? cube.faces.east ?? cube.faces.west;
      if (!face || face.texture === null) {
        continue;
      }
      const uv = face.uv;
      refs.push({
        cube,
        name: cube.name,
        pixelUV: [uv[0], uv[1], uv[2], uv[3]],
        textureKey: faceTextureKey(face),
      });
    }
  }
  return refs;
}

/** 解码引用到的纹理 / Decodes every referenced texture once. */
export function decodeReferencedTextures(items: readonly VoxelPixelRef[]): {
  textures: Map<string, PixelSource>;
  warnings: string[];
} {
  const textures = new Map<string, PixelSource>();
  const warnings: string[] = [];
  for (const item of items) {
    if (item.textureKey === null || textures.has(item.textureKey)) {
      continue;
    }
    const texture = resolveTextureByKey(item.textureKey);
    if (!texture) {
      warnings.push(`texture ${item.textureKey} is not loaded`);
      continue;
    }
    try {
      textures.set(item.textureKey, textureToPixelSource(texture));
    } catch (error) {
      warnings.push(`failed to read texture pixels (${String(error)})`);
    }
  }
  return { textures, warnings };
}

/**
 * 一键清除透明体素：单次撤销事务内移除采样像素 alpha 低于阈值的方块。
 * 收集与规划先于任何修改，任何错误都会回滚整个事务。
 * One-click transparent voxel cleanup: removes the cubes whose sampled pixel
 * alpha is at or below the threshold in one undo transaction. Collection and
 * planning finish before anything is modified; errors roll the whole
 * transaction back.
 */
export function clearTransparentCubes(host: WriterHost, alphaThreshold: number): ClearSummary {
  const refs = collectVoxelPixelRefs();
  if (refs.length === 0) {
    return { removed: 0, warnings: [] };
  }
  const { textures, warnings: decodeWarnings } = decodeReferencedTextures(refs);
  const plan = planTransparentRemovals(refs, textures, alphaThreshold);
  const warnings = [...decodeWarnings, ...plan.warnings];
  if (plan.removable.length === 0) {
    return { removed: 0, warnings };
  }

  host.beginUndo({ sources: plan.removable.map(item => item.cube), groups: [] });
  try {
    for (const item of plan.removable) {
      host.remove(item.cube);
    }
    host.finishUndo('Clear transparent cubes', { created: [], groups: [] });
    return { removed: plan.removable.length, warnings };
  } catch (error) {
    host.cancelUndo(true);
    throw error;
  }
}
