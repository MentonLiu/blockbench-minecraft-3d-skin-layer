import type { CommitAspects, UndoAspects } from './modelWriter';

/**
 * Blockbench Undo integration. Adding, removing or re-parenting outliner nodes
 * requires the `outliner` aspect; listing the removed sources also protects
 * their element data. Every generation run is one transaction: initEdit before
 * the first mutation, finishEdit after the last, cancelEdit(true) on error so
 * half-finished models cannot survive.
 */
export const blockbenchUndo = {
  begin(aspects: UndoAspects): void {
    const elements = aspects.sources as Cube[];
    Undo.initEdit({
      outliner: true,
      elements,
      selection: true,
    });
  },

  finish(label: string, aspects: CommitAspects): void {
    Undo.finishEdit(label, {
      outliner: true,
      elements: aspects.created as Cube[],
      groups: aspects.groups as Group[],
      selection: true,
    });
  },

  cancel(revertChanges: boolean): void {
    Undo.cancelEdit(revertChanges);
  },
};
