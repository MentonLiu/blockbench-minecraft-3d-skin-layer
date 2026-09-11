import { PLUGIN_ID } from './domain/constants';
import { VoxelLimitError } from './domain/types';
import type { GeneratorOptions, GenerationResult, LayerPlan, LayerSnapshot } from './domain/types';
import { buildVoxelPlans, countPlanVoxels } from './geometry/voxelPlanner';
import {
  buildTextureMap,
  collectLayerSnapshots,
  hasOpenProject,
  isEditMode,
  onProjectEvent,
} from './blockbench/compatibility';
import type { ProjectListener } from './blockbench/compatibility';
import { applyPlans } from './blockbench/modelWriter';
import type { WriterHost } from './blockbench/modelWriter';
import { blockbenchHost } from './blockbench/blockbenchHost';
import { loadOptions, persistOptions, showGenerationDialog } from './ui/settingsDialog';
import {
  reportBusy,
  reportError,
  reportGenerationResult,
  reportNoLayers,
  reportVoxelLimit,
  status,
  toast,
} from './ui/resultReporter';
import { logger } from './infra/logger';

export interface ScanOutcome {
  snapshots: LayerSnapshot[];
  plans: LayerPlan[];
  warnings: string[];
  voxelCount: number;
}

/** Pure preflight: snapshot layers, decode textures, plan voxels. No mutation. */
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

async function applyOutcome(outcome: ScanOutcome, options: GeneratorOptions): Promise<GenerationResult> {
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

async function runGeneration(auto: boolean): Promise<void> {
  if (!isEditMode()) {
    if (!auto) {
      toast('Switch to Edit mode to generate 3D skin layers', 'edit');
    }
    return;
  }
  if (!hasOpenProject()) {
    if (!auto) {
      toast('Open a project first', 'info');
    }
    return;
  }

  const options = loadOptions();
  const outcome = scanAndPlan(options);

  if (outcome.snapshots.length === 0) {
    if (!auto) {
      reportNoLayers();
    }
    return;
  }
  if (outcome.voxelCount > options.maxVoxels) {
    reportVoxelLimit(new VoxelLimitError(outcome.voxelCount, options.maxVoxels));
    return;
  }

  if (auto && !options.autoApplyOnLoad) {
    status(
      `${outcome.snapshots.length} skin layer cube(s) with ${outcome.voxelCount} texels detected - ` +
        'use "Generate 3D Skin Layers" to voxelize',
    );
    return;
  }

  if (auto) {
    const result = await applyOutcome(outcome, options);
    reportGenerationResult({ ...result, warnings: outcome.warnings });
    return;
  }

  const confirmed = await new Promise<GeneratorOptions | null>(resolve => {
    showGenerationDialog(
      { layerCount: outcome.snapshots.length, voxelCount: outcome.voxelCount, warnings: outcome.warnings },
      options,
      merged => {
        persistOptions(merged);
        resolve(merged);
      },
      () => resolve(null),
    );
  });
  if (!confirmed) {
    return;
  }

  const result = await applyOutcome(outcome, confirmed);
  reportGenerationResult({ ...result, warnings: outcome.warnings });
}

let running = false;

async function runGenerationGuarded(auto: boolean): Promise<void> {
  if (running) {
    reportBusy();
    return;
  }
  running = true;
  try {
    await runGeneration(auto);
  } catch (error) {
    if (error instanceof VoxelLimitError) {
      reportVoxelLimit(error);
    } else {
      logger.error('generation failed', error);
      reportError(error);
    }
  } finally {
    running = false;
  }
}

let actions: Action[] = [];
let listeners: { dispose(): void }[] = [];

function onProjectLoaded(): ProjectListener {
  return () => {
    void runGenerationGuarded(true);
  };
}

export function registerPlugin(): void {
  actions = [
    new Action(`${PLUGIN_ID}.generate`, {
      name: 'Generate 3D Skin Layers',
      description: 'Replace "* Layer" cubes with per-pixel voxel cubes',
      icon: 'view_in_ar',
      category: 'edit',
      condition: () => isEditMode() && hasOpenProject(),
      click: () => {
        void runGenerationGuarded(false);
      },
    }),
  ];

  listeners = [onProjectEvent('load_project', onProjectLoaded())];
}

export function unregisterPlugin(): void {
  for (const listener of listeners) {
    listener.dispose();
  }
  listeners = [];
  for (const action of actions) {
    action.delete();
  }
  actions = [];
}
