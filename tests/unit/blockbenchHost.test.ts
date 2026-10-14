import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoptInitializedElement, blockbenchHostForProject } from '../../src/blockbench/blockbenchHost';
import { isAutoScanSuppressed } from '../../src/blockbench/projectDuplicate';
import { bindWriterHost } from '../../src/operations/boundWriterHost';
import { ProjectOperationContext } from '../../src/operations/projectContext';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adoptInitializedElement', () => {
  it('removes the provisional root entry before attaching to a group', () => {
    const calls: string[] = [];
    const group = {} as Group;
    const element = {
      removeFromParent() { calls.push('remove'); },
      addTo(target?: Group | 'root') { calls.push(target === group ? 'group' : String(target)); },
    };

    adoptInitializedElement(element, group);

    expect(calls).toEqual(['remove', 'group']);
  });

  it('adds a root element exactly once after removing its provisional entry', () => {
    const calls: string[] = [];
    const element = {
      removeFromParent() { calls.push('remove'); },
      addTo(target?: Group | 'root') { calls.push(String(target)); },
    };

    adoptInitializedElement(element, null);

    expect(calls).toEqual(['remove', 'root']);
  });
});

function rollbackRuntime() {
  const events: string[] = [];
  const targetNodes = ['source', 'group-1', 'group-2', 'cube-1', 'cube-2'];
  const otherNodes = ['unrelated cube'];
  const makeProject = (uuid: string, nodes: string[]) => ({
    uuid,
    nodes,
    undo: {
      initEdit: vi.fn(),
      finishEdit: vi.fn(),
      cancelEdit: vi.fn((revert: boolean) => {
        events.push(`cancel:${uuid}:${Project.uuid}:${revert}`);
        if (revert) {
          // UndoSystem.loadSave operates on the current project globals.
          const active = Project as unknown as { nodes: string[] };
          active.nodes.splice(0, active.nodes.length, 'source');
        }
      }),
    },
    select: vi.fn(() => {
      events.push(`select:${uuid}:${isAutoScanSuppressed()}`);
      vi.stubGlobal('Project', uuid === 'target' ? target : other);
      return true;
    }),
  });
  const target = makeProject('target', targetNodes);
  const other = makeProject('other', otherNodes);
  vi.stubGlobal('Project', target);
  vi.stubGlobal('ModelProject', { all: [target, other] });
  // A global Undo lookup after the tab switch would cancel the other project.
  vi.stubGlobal('Undo', other.undo);
  const context = new ProjectOperationContext(() => Project, new AbortController().signal);
  context.bindActiveProject();
  const host = bindWriterHost(blockbenchHostForProject(target as unknown as ModelProject), context);
  host.beginUndo({ sources: [], groups: [] });
  const node = (name: string, fail?: Error) => ({
    remove: vi.fn(() => {
      events.push(`remove:${name}:${Project.uuid}`);
      if (fail) throw fail;
      const active = Project as unknown as { nodes: string[] };
      const index = active.nodes.indexOf(name);
      if (index >= 0) active.nodes.splice(index, 1);
    }),
  });
  const created = [node('cube-1'), node('cube-2')];
  const groups = [node('group-1'), node('group-2')];
  vi.stubGlobal('Project', other);
  return { host, target, other, created, groups, events, node };
}

describe('blockbenchHostForProject rollback', () => {
  it('cleans the target before cancelling its undo save and restores the active tab', () => {
    const { host, target, other, created, groups, events } = rollbackRuntime();
    expect(() => host.remove(created[0])).toThrowError(expect.objectContaining({ code: 'PROJECT_CHANGED' }));

    host.rollback?.(created, groups, true);

    expect(events).toEqual([
      'select:target:true',
      'remove:cube-2:target',
      'remove:cube-1:target',
      'remove:group-2:target',
      'remove:group-1:target',
      'cancel:target:target:true',
      'select:other:true',
    ]);
    expect(target.nodes).toEqual(['source']);
    expect(other.nodes).toEqual(['unrelated cube']);
    expect(target.undo.cancelEdit).toHaveBeenCalledExactlyOnceWith(true);
    expect(other.undo.cancelEdit).not.toHaveBeenCalled();
    expect(Project).toBe(other);
    expect(isAutoScanSuppressed()).toBe(false);
  });

  it('continues cleanup and cancellation after a node fails to remove', () => {
    const { host, target, other, groups, events, node } = rollbackRuntime();
    const removalFailure = new Error('mesh disposal failed');
    const created = [node('cube-1'), node('cube-2', removalFailure)];

    expect(() => host.rollback?.(created, groups, true)).toThrowError(
      expect.objectContaining({
        message: 'Blockbench could not fully roll back the skin operation.',
        cause: removalFailure,
      }),
    );

    expect(events).toContain('remove:cube-1:target');
    expect(events).toContain('remove:group-1:target');
    expect(target.undo.cancelEdit).toHaveBeenCalledExactlyOnceWith(true);
    expect(target.nodes).toEqual(['source']);
    expect(other.nodes).toEqual(['unrelated cube']);
    expect(Project).toBe(other);
    expect(isAutoScanSuppressed()).toBe(false);
  });

  it('restores the active tab and reports an undo restoration failure', () => {
    const { host, target, other, created, groups } = rollbackRuntime();
    const undoFailure = new Error('undo snapshot unavailable');
    target.undo.cancelEdit.mockImplementation(() => { throw undoFailure; });

    expect(() => host.rollback?.(created, groups, true)).toThrowError(
      expect.objectContaining({ cause: undoFailure }),
    );

    expect(other.undo.cancelEdit).not.toHaveBeenCalled();
    expect(other.nodes).toEqual(['unrelated cube']);
    expect(Project).toBe(other);
    expect(isAutoScanSuppressed()).toBe(false);
  });

  it('refuses to mutate or cancel any undo system when the target was closed', () => {
    const { host, target, other, created, groups, events } = rollbackRuntime();
    vi.stubGlobal('ModelProject', { all: [other] });

    expect(() => host.rollback?.(created, groups, true)).toThrow('target project was closed');

    expect(events).toEqual([]);
    expect(target.undo.cancelEdit).not.toHaveBeenCalled();
    expect(other.undo.cancelEdit).not.toHaveBeenCalled();
    expect(created[0].remove).not.toHaveBeenCalled();
    expect(groups[0].remove).not.toHaveBeenCalled();
    expect(other.nodes).toEqual(['unrelated cube']);
    expect(Project).toBe(other);
    expect(isAutoScanSuppressed()).toBe(false);
  });

  it.each(['refused', 'wrong-project', 'throws-after-switch'] as const)(
    'does not clean up or cancel undo if target selection %s',
    failure => {
      const { host, target, other, created, groups } = rollbackRuntime();
      target.select.mockImplementation(() => {
        if (failure === 'throws-after-switch') {
          vi.stubGlobal('Project', target);
          throw new Error('selection failed');
        }
        return failure === 'wrong-project';
      });

      expect(() => host.rollback?.(created, groups, true)).toThrow();

      expect(created[0].remove).not.toHaveBeenCalled();
      expect(groups[0].remove).not.toHaveBeenCalled();
      expect(target.undo.cancelEdit).not.toHaveBeenCalled();
      expect(other.undo.cancelEdit).not.toHaveBeenCalled();
      expect(target.nodes).toEqual(['source', 'group-1', 'group-2', 'cube-1', 'cube-2']);
      expect(other.nodes).toEqual(['unrelated cube']);
      expect(Project).toBe(other);
      expect(isAutoScanSuppressed()).toBe(false);
    },
  );

  it('cancels the captured undo on the target and restores the active tab without node cleanup', () => {
    const { host, target, other, events } = rollbackRuntime();

    host.cancelUndo(true);

    expect(events).toEqual([
      'select:target:true',
      'cancel:target:target:true',
      'select:other:true',
    ]);
    expect(target.nodes).toEqual(['source']);
    expect(other.nodes).toEqual(['unrelated cube']);
    expect(other.undo.cancelEdit).not.toHaveBeenCalled();
    expect(Project).toBe(other);
    expect(isAutoScanSuppressed()).toBe(false);
  });

  it.each(['refused-after-switch', 'throws-after-switch'] as const)(
    'restores the active tab when cancellation target selection %s',
    failure => {
      const { host, target, other } = rollbackRuntime();
      target.select.mockImplementation(() => {
        vi.stubGlobal('Project', target);
        if (failure === 'throws-after-switch') throw new Error('selection failed');
        return false;
      });

      expect(() => host.cancelUndo(true)).toThrow();

      expect(target.undo.cancelEdit).not.toHaveBeenCalled();
      expect(other.undo.cancelEdit).not.toHaveBeenCalled();
      expect(target.nodes).toEqual(['source', 'group-1', 'group-2', 'cube-1', 'cube-2']);
      expect(other.nodes).toEqual(['unrelated cube']);
      expect(Project).toBe(other);
      expect(isAutoScanSuppressed()).toBe(false);
    },
  );
});
