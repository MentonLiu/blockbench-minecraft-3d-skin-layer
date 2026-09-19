import type { GeneratorOptions, GenerationResult, LayerPlan, LayerSnapshot } from './domain/types';
import { buildVoxelPlans, countPlanVoxels } from './geometry/voxelPlanner';
import { buildTextureMap, collectLayerSnapshots } from './blockbench/compatibility';
import { applyPlans } from './blockbench/modelWriter';
import type { WriterHost } from './blockbench/modelWriter';
import { blockbenchHost } from './blockbench/blockbenchHost';

export interface ScanOutcome {
  snapshots: LayerSnapshot[];
  plans: LayerPlan[];
  warnings: string[];
  voxelCount: number;
}

/** 纯预检：快照层立方体、解码纹理、规划体素，不触碰模型 / Pure preflight: snapshot layers, decode textures, plan voxels. No mutation. */
export function scanAndPlan(options: GeneratorOptions): ScanOutcome {
  const snapshots = collectLayerSnapshots(options);
  const { textures, warnings: textureWarnings } = buildTextureMap(snapshots);
  const { plans, warnings: planWarnings } = buildVoxelPlans(snapshots, textures, options);
  const warnings = [...textureWarnings, ...planWarnings];
  return { snapshots, plans, warnings, voxelCount: countPlanVoxels(plans) };
}

function resolveCubeByKey(key: string): Cube | undefined {
  return Cube.all.find(cube => cube.uuid === key);
}

/** 在当前活动项目上应用计划 / Applies the plans against the active project. */
export async function applyOutcome(outcome: ScanOutcome, options: GeneratorOptions): Promise<GenerationResult> {
  const started = performance.now();
  const host: WriterHost = blockbenchHost;
  const summary = await applyPlans(
    outcome.plans,
    {
      maxVoxels: options.maxVoxels,
      batchSize: options.batchSize,
      preserveOriginal: options.preserveOriginal,
    },
    host,
    key => resolveCubeByKey(key),
  );
  return {
    createdCubes: summary.createdCubes,
    createdGroups: summary.createdGroups,
    durationMs: performance.now() - started,
  };
}
