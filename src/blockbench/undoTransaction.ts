import type { CommitAspects, UndoAspects } from './modelWriter';

/**
 * Blockbench 撤销系统集成。增删或移动大纲节点必须保存 `outliner` 切面；
 * 列出被删除的源立方体还能同时保护它们的元素数据。`groups` 列表在事务
 * 两端都要传递（开始为空、提交时为新建分组）——loadSave 会互相比较两个
 * save，缺少任何一侧都会让 redo 崩溃。每次生成运行为一个事务：第一次
 * 修改前 initEdit，最后一次修改后 finishEdit，出错时 cancelEdit(true)，
 * 保证模型不会留下半成品。
 *
 * Blockbench Undo integration. Adding, removing or re-parenting outliner
 * nodes requires the `outliner` aspect; listing the removed sources also
 * protects their element data. The `groups` list is forwarded on BOTH
 * transaction ends (empty before, created groups after) - loadSave compares
 * the two saves against each other, and a missing list crashes redo with
 * "groups is not iterable". Every generation run is one transaction.
 */
export const blockbenchUndo = {
  begin(aspects: UndoAspects): void {
    const elements = aspects.sources as Cube[];
    Undo.initEdit({
      outliner: true,
      elements,
      groups: aspects.groups as Group[],
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
