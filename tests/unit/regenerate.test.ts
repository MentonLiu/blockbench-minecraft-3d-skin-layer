import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import type { GeneratedLayerMetadata, LayerPlan, LayerSnapshot, VoxelSpec } from '../../src/domain/types';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import {
  applyRegenerations,
  buildRegenerationTargets,
  readRegenerationSource,
} from '../../src/blockbench/modelRegenerator';
import { loadFixtureModel } from '../helpers/referenceModel';
import { MockRuntime } from '../helpers/mockRuntime';
import type { MockNode } from '../helpers/mockRuntime';

function makeSnapshot(key: string, name: string): LayerSnapshot {
  return {
    key,
    name,
    from: [-4, 24, -4],
    to: [4, 32, 4],
    inflate: 0.5,
    stretch: [1, 1, 1],
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    visibility: false,
    faces: [
      { direction: 'north', enabled: true, textureKey: 'tex', uv: [8, 8, 16, 16], rotation: 0 },
    ],
  };
}

function makeVoxel(name: string): VoxelSpec {
  return {
    name,
    from: [0, 0, 0],
    to: [1, 1, 1],
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    textureKey: 'tex',
    pixelUV: [8, 8, 9, 9],
    face: 'north',
  };
}

/** 构造带 m3sl_source 元数据与体素子级的 mock 分组 / Builds a mock group with metadata and voxel children. */
function makeGeneratedGroup(
  runtime: MockRuntime,
  snapshot: LayerSnapshot,
  childCount: number,
): MockNode {
  const group = runtime.createGroup({ name: snapshot.name, origin: [3, 2, 1], visibility: true });
  runtime.initElement(group);
  const metadata: GeneratedLayerMetadata = { schema: 1, source: snapshot };
  (group as unknown as { restoreData: GeneratedLayerMetadata }).restoreData = metadata;
  (group as unknown as Record<string, unknown>).m3sl_source = metadata;
  for (let i = 0; i < childCount; i++) {
    const child = runtime.createCube(makeVoxel(`px_north_${i}_0`));
    runtime.initElement(child);
    runtime.adopt(child, group);
  }
  return group;
}

describe('readRegenerationSource', () => {
  it('reads valid metadata and rejects groups without it', () => {
    const snapshot = makeSnapshot('cube-1', 'Hat Layer');
    const withMeta = { m3sl_source: { schema: 1, source: snapshot } };
    expect(readRegenerationSource(withMeta)?.snapshot.key).toBe('cube-1');
    expect(readRegenerationSource({})).toBeUndefined();
    expect(readRegenerationSource({ m3sl_source: null })).toBeUndefined();
    expect(readRegenerationSource({ m3sl_source: { schema: 1 } })).toBeUndefined();
  });
});

describe('buildRegenerationTargets', () => {
  it('maps plans by snapshot key and empties groups without plans', () => {
    const snapshotA = makeSnapshot('cube-a', 'Hat Layer');
    const snapshotB = makeSnapshot('cube-b', 'Body Layer');
    const sources = [
      { group: { children: ['old-a1', 'old-a2'] }, snapshot: snapshotA },
      { group: { children: ['old-b1'] }, snapshot: snapshotB },
    ];
    const voxels = [makeVoxel('px_north_0_0'), makeVoxel('px_north_1_0')];
    const plans = [
      { sourceKey: 'cube-a', voxels } as unknown as LayerPlan,
    ];
    const targets = buildRegenerationTargets(sources, plans);
    expect(targets).toHaveLength(2);
    expect(targets[0].voxels).toHaveLength(2);
    expect(targets[0].oldChildren).toEqual(['old-a1', 'old-a2']);
    // 无计划的分组被清空（可见模式下的全透明层）
    // plan-less groups are emptied (fully transparent layers in visible mode)
    expect(targets[1].voxels).toHaveLength(0);
    expect(targets[1].oldChildren).toEqual(['old-b1']);
  });
});

describe('applyRegenerations', () => {
  it('keeps groups, removes old children and rebuilds new cubes inside them', async () => {
    const runtime = new MockRuntime();
    const snapshot = makeSnapshot('cube-a', 'Hat Layer');
    const group = makeGeneratedGroup(runtime, snapshot, 3);
    const sources = [{ group, snapshot }];
    const voxels = [makeVoxel('px_north_0_0'), makeVoxel('px_north_1_0')];
    const plans = [{ sourceKey: 'cube-a', voxels } as unknown as LayerPlan];

    const summary = await applyRegenerations(
      sources,
      plans,
      { maxVoxels: 10_000, batchSize: 200 },
      runtime,
    );

    expect(summary).toEqual({ replacedGroups: 1, removedCubes: 3, createdCubes: 2 });
    // 分组保留：origin（用户姿态）不被触碰，新方块成为其子级
    // the group is kept: its origin (user pose) is untouched, new cubes adopted
    expect(runtime.root).toContain(group);
    expect(group.origin).toEqual([3, 2, 1]);
    expect(group.children).toHaveLength(2);
    expect(group.children.every(child => child.name.startsWith('px_'))).toBe(true);
    // 撤销两端切面：开始时列旧子方块，提交时列新方块，分组列表两端一致为空
    // undo aspects: old children at begin, new cubes at finish, groups [] on both ends
    expect(runtime.beginAspects?.sources).toHaveLength(3);
    expect(runtime.beginAspects?.groups).toEqual([]);
    expect(runtime.finishAspects?.created).toHaveLength(2);
    expect(runtime.finishAspects?.groups).toEqual([]);
  });

  it('empties groups whose plan has no voxels', async () => {
    const runtime = new MockRuntime();
    const snapshot = makeSnapshot('cube-a', 'Body Layer');
    const group = makeGeneratedGroup(runtime, snapshot, 2);
    const summary = await applyRegenerations(
      [{ group, snapshot }],
      [],
      { maxVoxels: 10_000, batchSize: 200 },
      runtime,
    );
    expect(summary).toEqual({ replacedGroups: 1, removedCubes: 2, createdCubes: 0 });
    expect(runtime.root).toContain(group);
    expect(group.children).toHaveLength(0);
  });

  it('rolls the whole transaction back when cube creation fails', async () => {
    const runtime = new MockRuntime();
    const snapshot = makeSnapshot('cube-a', 'Hat Layer');
    const group = makeGeneratedGroup(runtime, snapshot, 2);
    runtime.failCubeCreationAfter = 1; // 第 2 个方块创建时失败
    const voxels = [makeVoxel('a'), makeVoxel('b')];
    await expect(
      applyRegenerations(
        [{ group, snapshot }],
        [{ sourceKey: 'cube-a', voxels } as unknown as LayerPlan],
        { maxVoxels: 10_000, batchSize: 200 },
        runtime,
      ),
    ).rejects.toThrow('simulated cube creation failure');
    // 回滚后：旧子方块回到分组，分组仍在大纲上
    // after rollback: old children back in the group, group still in the outliner
    expect(runtime.cancelCount).toBe(1);
    expect(runtime.root).toContain(group);
    expect(group.children).toHaveLength(2);
    expect(group.children[0].name).toBe('px_north_0_0');
  });

  it('aborts with VoxelLimitError before any mutation', async () => {
    const runtime = new MockRuntime();
    const snapshot = makeSnapshot('cube-a', 'Hat Layer');
    const group = makeGeneratedGroup(runtime, snapshot, 2);
    const voxels = [makeVoxel('a'), makeVoxel('b'), makeVoxel('c')];
    await expect(
      applyRegenerations(
        [{ group, snapshot }],
        [{ sourceKey: 'cube-a', voxels } as unknown as LayerPlan],
        { maxVoxels: 2, batchSize: 200 },
        runtime,
      ),
    ).rejects.toThrow('exceeds maxVoxels');
    expect(runtime.beginCount).toBe(0);
    expect(group.children).toHaveLength(2);
  });
});

describe('snapshot metadata round-trip (regenerate from saved groups)', () => {
  it('plans identical voxels from JSON-round-tripped snapshots', () => {
    const model = loadFixtureModel('skins_model_root.bbmodel');
    const original = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    // 模拟 bbmodel 保存/加载：元数据经 JSON 序列化往返
    // simulate bbmodel save/load: metadata goes through JSON serialization
    const restored: LayerSnapshot[] = JSON.parse(
      JSON.stringify(model.snapshots.map(snapshot => ({ schema: 1, source: snapshot }))),
    ).map((metadata: GeneratedLayerMetadata) => metadata.source);
    const regenerated = buildVoxelPlans(restored, model.textures, DEFAULT_OPTIONS);
    expect(regenerated.warnings).toEqual([]);
    expect(countPlanVoxels(regenerated.plans)).toBe(countPlanVoxels(original.plans));
    expect(countPlanVoxels(regenerated.plans)).toBe(618);
    const nameOf = (outcome: { plans: LayerPlan[] }) =>
      outcome.plans.flatMap(plan => plan.voxels.map(voxel => `${plan.sourceName}/${voxel.name}`)).sort();
    expect(nameOf(regenerated)).toEqual(nameOf(original));
  });
});
