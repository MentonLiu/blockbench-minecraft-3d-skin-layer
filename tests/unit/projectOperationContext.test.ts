import { describe, expect, it } from 'vitest';
import type { WriterHost } from '../../src/blockbench/modelWriter';
import { SkinOperationError } from '../../src/operations/errors';
import { bindWriterHost } from '../../src/operations/boundWriterHost';
import { ProjectOperationContext } from '../../src/operations/projectContext';

function makeHost(overrides: Partial<WriterHost> = {}): WriterHost {
  const noop = () => undefined;
  return {
    beginUndo: noop,
    finishUndo: noop,
    cancelUndo: noop,
    createGroup: () => ({}),
    createCube: () => ({}),
    createCubeFromSnapshot: () => ({}),
    initElement: noop,
    adopt: noop,
    placeBefore: noop,
    parentOf: () => null,
    remove: noop,
    setVisibility: noop,
    updateView: noop,
    resolveTexture: () => undefined,
    yieldToUI: async () => undefined,
    ...overrides,
  };
}

describe('ProjectOperationContext', () => {
  it('rejects writes after switching projects and still permits rollback on the captured host', async () => {
    let active = { uuid: 'project-a' };
    const controller = new AbortController();
    const context = new ProjectOperationContext(() => active, controller.signal);
    context.bindActiveProject();
    let removed = 0;
    let cancelled = 0;
    const host = bindWriterHost(makeHost({
      remove: () => { removed++; },
      cancelUndo: () => { cancelled++; },
      yieldToUI: async () => { active = { uuid: 'project-b' }; },
    }), context);

    await expect(host.yieldToUI()).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    expect(() => host.remove({})).toThrow(SkinOperationError);
    host.cancelUndo(true);
    expect(removed).toBe(0);
    expect(cancelled).toBe(1);
  });

  it('requires the captured project to remain open and detects cancellation', () => {
    const project = { uuid: 'project-a' };
    let open = true;
    const controller = new AbortController();
    const context = new ProjectOperationContext(() => project, controller.signal, () => open);
    context.bindActiveProject();
    open = false;
    expect(() => context.assertActive()).toThrowError(expect.objectContaining({ code: 'PROJECT_CHANGED' }));

    open = true;
    controller.abort(new SkinOperationError('CANCELLED', 'Stopped'));
    expect(() => context.assertActive()).toThrowError(expect.objectContaining({ code: 'CANCELLED' }));
  });

  it('rolls back through the captured project host even after the active project changes', () => {
    let active = { uuid: 'project-a' };
    const context = new ProjectOperationContext(() => active, new AbortController().signal);
    context.bindActiveProject();
    const created = [{}];
    const groups = [{}];
    const calls: unknown[][] = [];
    const host = bindWriterHost(makeHost({
      rollback: (cubes, rollbackGroups, revert) => calls.push([cubes, rollbackGroups, revert]),
    }), context);
    active = { uuid: 'project-b' };

    host.rollback?.(created, groups, true);

    expect(calls).toEqual([[created, groups, true]]);
  });
});
