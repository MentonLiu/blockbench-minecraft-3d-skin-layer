import type { LayerSnapshot } from '../domain/types';
import type { CommitAspects, UndoAspects } from './modelWriter';

export interface RestoreCandidate {
  /** The generated group to remove. */
  group: unknown;
  /** Generated voxel children, included in the undo snapshot. */
  children: readonly unknown[];
  /** Exact original cube data, or a best-effort legacy reconstruction. */
  source: LayerSnapshot;
  /** Existing hidden source cube when generation used preserveOriginal. */
  existingSource?: unknown;
}

export interface RestoreHost {
  beginUndo(aspects: UndoAspects): void;
  finishUndo(label: string, aspects: CommitAspects): void;
  cancelUndo(revertChanges: boolean): void;
  createCubeFromSnapshot(snapshot: LayerSnapshot): unknown;
  initElement(element: unknown): void;
  adopt(element: unknown, parent: unknown | null): void;
  placeBefore(element: unknown, target: unknown): void;
  parentOf(element: unknown): unknown | null;
  remove(element: unknown): void;
  setVisibility(element: unknown, visible: boolean): void;
  updateView(created: readonly unknown[], groups: readonly unknown[]): void;
}

export interface RestoreSummary {
  restoredCubes: number;
  restoredGroups: number;
  removedVoxels: number;
}

/**
 * Restore generated layer groups in one atomic Blockbench undo transaction.
 * Restores are deliberately data-driven: metadata-backed groups are exact,
 * while legacy groups are supplied by the compatibility layer.
 */
export function applyRestores(
  candidates: readonly RestoreCandidate[],
  host: RestoreHost,
): RestoreSummary {
  if (candidates.length === 0) {
    return { restoredCubes: 0, restoredGroups: 0, removedVoxels: 0 };
  }

  const groups = candidates.map(candidate => candidate.group);
  const children = candidates.flatMap(candidate => [...candidate.children]);
  host.beginUndo({ sources: children, groups });

  const restored: unknown[] = [];
  let removedVoxels = 0;
  try {
    for (const candidate of candidates) {
      const parent = host.parentOf(candidate.group);
      if (candidate.existingSource !== undefined) {
        host.setVisibility(candidate.existingSource, candidate.source.visibility);
      } else {
        const cube = host.createCubeFromSnapshot(candidate.source);
        host.initElement(cube);
        host.adopt(cube, parent);
        host.placeBefore(cube, candidate.group);
        restored.push(cube);
      }
      removedVoxels += candidate.children.length;
      host.remove(candidate.group);
    }

    host.updateView(restored, []);
    host.finishUndo('Restore 3D skin layers', { created: restored, groups: [] });
    return {
      restoredCubes: candidates.length,
      restoredGroups: candidates.length,
      removedVoxels,
    };
  } catch (error) {
    host.cancelUndo(true);
    throw error;
  }
}
