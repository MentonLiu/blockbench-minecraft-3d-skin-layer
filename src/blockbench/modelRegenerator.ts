import { GENERATED_SOURCE_PROPERTY } from '../domain/constants';
import { VoxelLimitError } from '../domain/types';
import type { GeneratedLayerMetadata, GeneratorOptions, LayerPlan, LayerSnapshot, VoxelSpec } from '../domain/types';
import { buildVoxelPlans, countPlanVoxels } from '../geometry/voxelPlanner';
import { buildTextureMap } from './compatibility';
import type { WriterHost } from './modelWriter';

export interface RegenerationSource {
  /** 活动的生成分组 / The live generated group. */
  group: unknown;
  /** 分组上保存的原始层快照 / The original layer snapshot stored on the group. */
  snapshot: LayerSnapshot;
}

export interface RegenerationTarget {
  group: unknown;
  /** 事务开始时该分组的全部子方块 / All of the group's children at transaction start. */
  oldChildren: readonly unknown[];
  voxels: readonly VoxelSpec[];
}

export interface RegenerationSummary {
  replacedGroups: number;
  removedCubes: number;
  createdCubes: number;
}

/**
 * 从分组读取 m3sl_source 元数据（纯函数，便于测试）。没有有效元数据的
 * 分组（例如 0.3.1 之前生成的旧分组）返回 undefined——重新生成不支持它们。
 * Reads the m3sl_source metadata off a group (pure, testable). Groups without
 * valid metadata (e.g. pre-0.3.1 legacy groups) yield undefined - regeneration
 * does not support them.
 */
export function readRegenerationSource(group: unknown): RegenerationSource | undefined {
  const metadata = (group as unknown as Record<string, unknown> | null)?.[
    GENERATED_SOURCE_PROPERTY
  ] as GeneratedLayerMetadata | null | undefined;
  if (!metadata || typeof metadata !== 'object' || !metadata.source) {
    return undefined;
  }
  return { group, snapshot: metadata.source };
}

/** 收集当前项目中所有可重新生成的分组 / Collects every regeneratable group in the project. */
export function collectRegenerationSources(): RegenerationSource[] {
  if (typeof Group === 'undefined') {
    return [];
  }
  return Group.all.flatMap(group => {
    const source = readRegenerationSource(group);
    return source ? [source] : [];
  });
}

/** 是否存在可重新生成的分组 / Whether at least one regeneratable group exists. */
export function hasRegeneratableGroups(): boolean {
  if (typeof Group === 'undefined') {
    return false;
  }
  return Group.all.some(group => readRegenerationSource(group) !== undefined);
}

/**
 * 重新生成只替换纹理全部读取成功的层；全透明层保留显式空计划，以便清理旧体素。
 * Regeneration replaces a layer only when all of its enabled faces have usable
 * textures. Explicit empty plans distinguish fully transparent layers from
 * layers skipped because their texture is missing or unreadable.
 */
export function planRegenerations(
  sources: readonly RegenerationSource[],
  options: GeneratorOptions,
) {
  const snapshots = sources.map(source => source.snapshot);
  const { textures, warnings: textureWarnings } = buildTextureMap(snapshots);
  const warnings = [...textureWarnings];
  const readable = snapshots.filter(snapshot => {
    const missing = snapshot.faces.some(face =>
      face.enabled && (face.textureKey === null || !textures.has(face.textureKey)),
    );
    if (missing) {
      warnings.push(`${snapshot.name}: layer has an enabled face without a usable texture, regeneration skipped`);
    }
    return !missing;
  });
  const { plans, warnings: planWarnings } = buildVoxelPlans(
    readable,
    textures,
    { ...options, replaceEmptyLayer: true },
  );
  warnings.push(...planWarnings);
  return { snapshots, plans, warnings, voxelCount: countPlanVoxels(plans) };
}

/**
 * 重建体素的替换目标：按快照 key 把计划映射回分组。无计划的分组保留；
 * 只有显式空计划才清空旧子方块。
 * Replacement targets for regeneration: plans are mapped back onto groups by
 * snapshot key. Groups without a plan are kept; only explicit empty plans
 * remove all old children without creating new cubes.
 */
export function buildRegenerationTargets(
  sources: readonly RegenerationSource[],
  plans: readonly LayerPlan[],
): RegenerationTarget[] {
  const planByKey = new Map(plans.map(plan => [plan.sourceKey, plan]));
  return sources.flatMap(source => {
    const plan = planByKey.get(source.snapshot.key);
    if (!plan) {
      return [];
    }
    return [{
      group: source.group,
      oldChildren: [...((source.group as { children?: unknown[] }).children ?? [])],
      voxels: plan.voxels,
    }];
  });
}

/**
 * 原位重新生成：保留分组本身（分组上的旋转/位移/可见性等姿态不动），
 * 移除全部旧体素子方块并按计划重建。预检 maxVoxels 后打开单个撤销
 * 事务，分批创建并让出 UI，任何错误回滚整个事务。
 * In-place regeneration: the groups themselves are kept (their pose -
 * rotation, translation, visibility - is untouched), all old voxel children
 * are removed and rebuilt from the plans. Preflights maxVoxels, opens one
 * undo transaction, creates cubes in batches with UI yields, and rolls the
 * whole transaction back on any error.
 */
export async function applyRegenerations(
  sources: readonly RegenerationSource[],
  plans: readonly LayerPlan[],
  options: { maxVoxels: number; batchSize: number },
  host: WriterHost,
): Promise<RegenerationSummary> {
  const voxelCount = plans.reduce((sum, plan) => sum + plan.voxels.length, 0);
  if (voxelCount > options.maxVoxels) {
    throw new VoxelLimitError(voxelCount, options.maxVoxels);
  }
  const targets = buildRegenerationTargets(sources, plans);
  if (targets.length === 0) {
    return { replacedGroups: 0, removedCubes: 0, createdCubes: 0 };
  }

  const oldChildren = targets.flatMap(target => [...target.oldChildren]);

  host.beginUndo({ sources: oldChildren, groups: [] });
  const created: unknown[] = [];
  let batch = 0;
  try {
    for (const target of targets) {
      for (const child of target.oldChildren) {
        host.remove(child);
      }
      for (const spec of target.voxels) {
        const cube = host.createCube(spec);
        created.push(cube);
        host.initElement(cube);
        host.adopt(cube, target.group);
        if (++batch >= options.batchSize) {
          batch = 0;
          await host.yieldToUI();
        }
      }
    }
    if (batch > 0) {
      await host.yieldToUI();
    }
    host.finishUndo('Regenerate 3D skin layers', { created, groups: [] });
    return {
      replacedGroups: targets.length,
      removedCubes: oldChildren.length,
      createdCubes: created.length,
    };
  } catch (error) {
    if (host.rollback) {
      host.rollback(created, [], true);
    } else {
      host.cancelUndo(true);
    }
    throw error;
  }
}
