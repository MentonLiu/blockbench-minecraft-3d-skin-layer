import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans } from '../../src/geometry/voxelPlanner';
import { applyPlans } from '../../src/blockbench/modelWriter';
import { applyRestores } from '../../src/blockbench/modelRestorer';
import { MockRuntime } from '../helpers/mockRuntime';
import { loadReferenceModel } from '../helpers/referenceModel';

function buildGeneratedRuntime() {
  const model = loadReferenceModel();
  const runtime = new MockRuntime();
  const source = model.snapshots.find(snapshot => snapshot.name === 'Hat Layer')!;
  const sourceNode = {
    kind: 'cube' as const,
    uuid: source.key,
    name: source.name,
    origin: [...source.origin] as [number, number, number],
    rotation: [...source.rotation] as [number, number, number],
    visibility: source.visibility,
    parent: null,
    children: [],
    spec: undefined,
  };
  runtime.registry.set(sourceNode.uuid, sourceNode);
  runtime.root.push(sourceNode);
  const { plans } = buildVoxelPlans([source], model.textures, DEFAULT_OPTIONS);
  return { model, runtime, source, sourceNode, plans };
}

describe('applyRestores', () => {
  it('restores a metadata-backed group to the original cube in one undo step', async () => {
    const { runtime, source, plans } = buildGeneratedRuntime();
    await applyPlans(plans, { ...DEFAULT_OPTIONS }, runtime, key => runtime.registry.get(key));
    const group = runtime.find('Hat Layer')!;
    expect(group.kind).toBe('group');
    expect(group.restoreData?.source.from).toEqual(source.from);

    const generated = runtime.snapshot();
    const result = applyRestores(
      [{ group, children: group.children, source: group.restoreData!.source }],
      runtime,
    );

    expect(result).toEqual({ restoredCubes: 1, restoredGroups: 1, removedVoxels: 168 });
    const restored = runtime.find('Hat Layer')!;
    expect(restored.kind).toBe('cube');
    expect(restored.spec?.from).toEqual(source.from);
    expect(restored.spec?.to).toEqual(source.to);
    expect(runtime.beginCount).toBe(2);
    expect(runtime.finishCount).toBe(2);

    runtime.undo();
    expect(runtime.snapshot()).toEqual(generated);
    runtime.redo();
    expect(runtime.find('Hat Layer')?.kind).toBe('cube');
  });

  it('reveals the preserved original cube instead of duplicating it', async () => {
    const { runtime, source, sourceNode, plans } = buildGeneratedRuntime();
    await applyPlans(
      plans,
      { ...DEFAULT_OPTIONS, preserveOriginal: true },
      runtime,
      key => runtime.registry.get(key),
    );
    const group = runtime.find('Hat Layer')!;
    const hiddenSource = runtime.registry.get(source.key)!;
    expect(hiddenSource.visibility).toBe(false);

    const result = applyRestores(
      [{ group, children: group.children, source, existingSource: hiddenSource }],
      runtime,
    );

    expect(result.restoredCubes).toBe(1);
    expect(runtime.find('Hat Layer')).toBe(sourceNode);
    expect(sourceNode.visibility).toBe(source.visibility);
    expect(runtime.removedCount).toBe(1); // only the generated group is removed
  });
});
