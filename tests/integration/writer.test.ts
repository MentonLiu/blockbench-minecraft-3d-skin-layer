import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { VoxelLimitError } from '../../src/domain/types';
import { buildVoxelPlans } from '../../src/geometry/voxelPlanner';
import { applyPlans } from '../../src/blockbench/modelWriter';
import { MockRuntime, addSourceCube } from '../helpers/mockRuntime';
import type { MockSourceSpec } from '../helpers/mockRuntime';
import { loadReferenceModel } from '../helpers/referenceModel';

function buildReferenceRuntime() {
  const model = loadReferenceModel();
  const runtime = new MockRuntime();

  // 复刻参考模型的大纲：Waist -> Head/Body/Right Arm/Left Arm，双腿在根级
  // mirror the reference outliner: Waist -> Head/Body/Right Arm/Left Arm, legs at root
  const groupNodes = new Map<string, { uuid: string; name: string }>();
  const ensureGroup = (json: { uuid: string; name: string }) => {
    const existing = runtime.registry.get(json.uuid);
    if (existing) {
      return existing;
    }
    const node = runtime.createGroup({ name: json.name, origin: [0, 0, 0], visibility: true });
    // createGroup 分配的是 mock uuid；这里对齐为模型中的 uuid
    // createGroup assigned a mock uuid; align it with the model uuid
    runtime.registry.delete(node.uuid);
    node.uuid = json.uuid;
    runtime.registry.set(node.uuid, node);
    groupNodes.set(node.uuid, json);
    runtime.initElement(node);
    return node;
  };

  const findElement = (uuid: string) => model.raw.elements.find(element => element.uuid === uuid);
  const findGroup = (uuid: string) => model.raw.groups.find(group => group.uuid === uuid);

  const build = (entry: unknown): void => {
    if (typeof entry === 'string') {
      const element = findElement(entry);
      if (element) {
        addSourceCube(runtime, {
          uuid: element.uuid,
          name: element.name,
          from: element.from as [number, number, number],
          to: element.to as [number, number, number],
          visibility: element.visibility !== false,
        });
        return;
      }
      const group = findGroup(entry);
      if (group) {
        build(group);
      }
      return;
    }
    const node = entry as { uuid: string; children: unknown[] };
    const group = findGroup(node.uuid);
    if (!group) {
      return;
    }
    const groupNode = ensureGroup(group);
    for (const child of node.children) {
      const before = groupNode.children.length;
      if (typeof child === 'string') {
        const element = findElement(child);
        if (element) {
          addSourceCube(runtime, {
            uuid: element.uuid,
            name: element.name,
            from: element.from as [number, number, number],
            to: element.to as [number, number, number],
            visibility: element.visibility !== false,
          });
          runtime.adopt(runtime.registry.get(element.uuid), groupNode);
          expect(groupNode.children.length).toBe(before + 1);
        }
      } else {
        build(child);
        const childGroup = runtime.registry.get((child as { uuid: string }).uuid);
        if (childGroup) {
          runtime.adopt(childGroup, groupNode);
        }
      }
    }
  };

  for (const entry of model.raw.outliner) {
    build(entry);
  }

  const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
  return { model, runtime, plans };
}

describe('applyPlans against the mock outliner', () => {
  it('replaces layer cubes with same-name groups in the original position', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    const summary = await applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key =>
      runtime.registry.get(key),
    );

    expect(runtime.find('Hat Layer')?.kind).toBe('group');
    expect(runtime.find('Body Layer')?.kind).toBe('group');
    expect(runtime.find('Right Leg Layer')?.kind).toBe('group');

    const hatGroup = runtime.find('Hat Layer')!;
    expect(hatGroup.parent?.name).toBe('Head');
    expect(hatGroup.children).toHaveLength(168);
    // 分组占据了源立方体的兄弟位置（在基础 "Head" 立方体之后）
    // the group took the source cube's sibling slot (after the base "Head" cube)
    expect(hatGroup.parent!.children.map(child => child.name)).toEqual(['Head', 'Hat Layer']);

    const legGroup = runtime.find('Right Leg Layer')!;
    expect(legGroup.parent?.name).toBe('Right Leg');

    // 基础立方体未受影响
    // base cubes untouched
    expect(runtime.cubes().some(cube => cube.name === 'Head')).toBe(true);
    expect(runtime.cubes().some(cube => cube.name === 'Body')).toBe(true);
    // 原始层立方体已被删除
    // original layer cubes removed
    expect(runtime.cubes().filter(cube => /\sLayer$/i.test(cube.name))).toHaveLength(0);
    expect(summary.createdCubes).toBe(880);
    expect(summary.createdGroups).toBe(6);
  });

  it('inherits visibility and origin from the source cube', () => {
    const { runtime, plans } = buildReferenceRuntime();
    applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key));
    const hatGroup = runtime.find('Hat Layer')!;
    expect(hatGroup.visibility).toBe(false);
    expect(hatGroup.origin).toEqual([0, 0, 0]);
  });

  it('runs as one atomic undo transaction', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    await applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key));
    expect(runtime.beginCount).toBe(1);
    expect(runtime.finishCount).toBe(1);
    expect(runtime.cancelCount).toBe(0);
  });

  it('passes the groups aspect to both undo transaction ends', async () => {
    // Blockbench 的 loadSave 会前后对比两个 save；
    // 任一侧缺少 groups 列表都会让 undo/redo 崩溃（"groups is not iterable"）
    // Blockbench's loadSave compares the before/after saves against each other;
    // a missing groups list on either side crashes undo/redo ("groups is not iterable")
    const { runtime, plans } = buildReferenceRuntime();
    await applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key));
    expect(Array.isArray(runtime.beginAspects?.groups)).toBe(true);
    expect(runtime.beginAspects?.groups).toHaveLength(0);
    expect(runtime.finishAspects?.groups).toHaveLength(6);
  });

  it('undo restores the original tree and redo restores the voxels', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    const before = runtime.snapshot();
    await applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key));
    const generated = runtime.snapshot();

    runtime.undo();
    expect(runtime.snapshot()).toEqual(before);
    expect(runtime.cubes().filter(cube => cube.name === 'Hat Layer')).toHaveLength(1);

    runtime.redo();
    expect(runtime.snapshot()).toEqual(generated);
    expect(runtime.find('Hat Layer')!.children).toHaveLength(168);
  });

  it('aborts before any mutation when maxVoxels is exceeded', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    const before = runtime.snapshot();
    await expect(
      applyPlans(plans, { ...DEFAULT_OPTIONS, maxVoxels: 100 }, runtime, key =>
        runtime.registry.get(key),
      ),
    ).rejects.toThrow(VoxelLimitError);
    expect(runtime.snapshot()).toEqual(before);
    expect(runtime.beginCount).toBe(0);
  });

  it('reverts the model when cube creation fails mid-run', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    const before = runtime.snapshot();
    runtime.failCubeCreationAfter = 10;
    await expect(
      applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key)),
    ).rejects.toThrow('simulated cube creation failure');
    expect(runtime.cancelCount).toBe(1);
    expect(runtime.snapshot()).toEqual(before);
  });

  it('yields to the UI between batches', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    await applyPlans(
      plans,
      { ...DEFAULT_OPTIONS, batchSize: 200 },
      runtime,
      key => runtime.registry.get(key),
    );
    expect(runtime.yieldCount).toBe(5); // ceil(880 / 200)：4 个整批 + 最后一个不满批
    // expect(runtime.yieldCount).toBe(5); // ceil(880 / 200): 4 full batches + the final partial one
    expect(runtime.viewUpdates).toEqual([{ elements: 880, groups: 6 }]);
  });

  it('keeps and hides source cubes with preserveOriginal', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    await applyPlans(
      plans,
      { ...DEFAULT_OPTIONS, preserveOriginal: true },
      runtime,
      key => runtime.registry.get(key),
    );
    const hatSource = runtime.cubes().find(cube => cube.name === 'Hat Layer');
    expect(hatSource).toBeDefined();
    expect(hatSource!.visibility).toBe(false);
    expect(runtime.removedCount).toBe(0);
  });

  it('is idempotent: a converted model has no layer cubes left to scan', async () => {
    const { runtime, plans } = buildReferenceRuntime();
    await applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key));
    expect(runtime.scanLayerCubes()).toHaveLength(0);
  });
});

describe('small synthetic runtime', () => {
  it('handles a single layer cube end to end', async () => {
    const runtime = new MockRuntime();
    const spec: MockSourceSpec = {
      uuid: 'src-1',
      name: 'Test Layer',
      from: [-1, 0, -1],
      to: [1, 2, 1],
    };
    addSourceCube(runtime, spec);
    expect(runtime.scanLayerCubes()).toHaveLength(1);

    const plan = buildVoxelPlans(
      [
        {
          key: 'src-1',
          name: 'Test Layer',
          from: [-1, 0, -1],
          to: [1, 2, 1],
          inflate: 0,
          stretch: [1, 1, 1],
          origin: [0, 0, 0],
          rotation: [0, 0, 0],
          visibility: true,
          faces: [],
        },
      ],
      new Map(),
      DEFAULT_OPTIONS,
    );
    // 没有面 → 没有可替换的内容（空层保持原样）
    // no faces -> nothing to replace (empty layer stays untouched)
    expect(plan.plans).toHaveLength(0);
  });
});
