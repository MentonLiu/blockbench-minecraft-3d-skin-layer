import { VoxelLimitError } from '../domain/types';
import type { LayerPlan, VoxelSpec } from '../domain/types';
import { countPlanVoxels } from '../geometry/voxelPlanner';

export interface GroupSpec {
  name: string;
  origin: [number, number, number];
  visibility: boolean;
}

export interface UndoAspects {
  sources: unknown[];
  /**
   * 事务涉及的分组：开始时为空列表，提交时为新建的分组。Blockbench 的
   * loadSave 会前后对比两个 save，任何一侧缺少 groups 都会导致
   * undo/redo 崩溃（"groups is not iterable"）。
   * Groups involved in the transaction; empty at start, the created groups at
   * commit. Blockbench's loadSave compares the before/after saves against each
   * other, so the `groups` list must be present on BOTH ends - omitting it
   * crashes redo with "groups is not iterable".
   */
  groups: unknown[];
}

export interface CommitAspects {
  created: unknown[];
  groups: unknown[];
}

/**
 * 生成算法与 Blockbench 运行时之间的接缝。生产环境宿主包装真实的全局
 * API；测试提供具有相同大纲/撤销语义的 mock，使分组替换与回滚保持可测。
 * Seam between the generation algorithm and the Blockbench runtime. The
 * production host wraps the real global APIs; tests provide a mock with the
 * same outliner/undo semantics so group replacement and rollback stay tested.
 */
export interface WriterHost {
  beginUndo(aspects: UndoAspects): void;
  finishUndo(label: string, aspects: CommitAspects): void;
  cancelUndo(revertChanges: boolean): void;
  createGroup(spec: GroupSpec): unknown;
  createCube(spec: VoxelSpec): unknown;
  /** 向大纲根注册元素 / Registers the element with the outliner root. */
  initElement(element: unknown): void;
  /** 重挂载元素的父级；null 表示大纲根 / Reparents the element; null means root. */
  adopt(element: unknown, parent: unknown | null): void;
  /** 在同一父级内移动到目标元素之前 / Moves the element in front of the target. */
  placeBefore(element: unknown, target: unknown): void;
  parentOf(element: unknown): unknown | null;
  remove(element: unknown): void;
  setVisibility(element: unknown, visible: boolean): void;
  updateView(created: readonly unknown[], groups: readonly unknown[]): void;
  resolveTexture(key: string): unknown;
  yieldToUI(): Promise<void>;
}

export interface SourceLookup {
  (key: string): unknown | undefined;
}

export interface ApplyOptions {
  maxVoxels: number;
  batchSize: number;
  preserveOriginal: boolean;
}

export interface ApplySummary {
  createdCubes: number;
  createdGroups: number;
  removedSources: number;
}

/**
 * 以单个事务应用所有计划：先对 maxVoxels 做预检，然后打开一个撤销作用域，
 * 分批创建体素并让出 UI，最后只做定向视图更新。任何错误都会通过 cancelUndo
 * 回滚整个运行，然后再抛出。
 * Applies the plans as one transaction: preflight against maxVoxels, a single
 * undo scope, batched cube creation with UI yields, then targeted view updates.
 * Any error reverts the whole run via cancelUndo before rethrowing.
 */
export async function applyPlans(
  plans: readonly LayerPlan[],
  options: ApplyOptions,
  host: WriterHost,
  resolveSource: SourceLookup,
): Promise<ApplySummary> {
  const voxelCount = countPlanVoxels(plans);
  if (voxelCount > options.maxVoxels) {
    throw new VoxelLimitError(voxelCount, options.maxVoxels);
  }
  if (plans.length === 0) {
    return { createdCubes: 0, createdGroups: 0, removedSources: 0 };
  }

  const sources = plans.map(plan => resolveSource(plan.sourceKey));
  if (sources.some(source => source === undefined)) {
    throw new Error('Layer cubes changed while planning; aborting generation');
  }

  host.beginUndo({ sources, groups: [] });
  const created: unknown[] = [];
  const groups: unknown[] = [];
  let removedSources = 0;
  let batch = 0;

  try {
    for (const plan of plans) {
      const source = resolveSource(plan.sourceKey) as unknown;
      const parent = host.parentOf(source);

      const group = host.createGroup({
        name: plan.sourceName,
        origin: [...plan.origin],
        visibility: plan.visibility,
      });
      host.initElement(group);
      host.adopt(group, parent);
      host.placeBefore(group, source);
      groups.push(group);

      for (const spec of plan.voxels) {
        const cube = host.createCube(spec);
        host.initElement(cube);
        host.adopt(cube, group);
        created.push(cube);
        batch++;
        if (batch >= options.batchSize) {
          batch = 0;
          await host.yieldToUI();
        }
      }

      if (options.preserveOriginal) {
        host.setVisibility(source, false);
      } else {
        host.remove(source);
        removedSources++;
      }
    }
    if (batch > 0) {
      await host.yieldToUI();
    }

    host.updateView(created, groups);
    host.finishUndo('Generate 3D skin layers', { created, groups });
    return { createdCubes: created.length, createdGroups: groups.length, removedSources };
  } catch (error) {
    host.cancelUndo(true);
    throw error;
  }
}
