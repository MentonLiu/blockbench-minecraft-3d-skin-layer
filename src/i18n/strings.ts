/**
 * UI string catalog. The English dictionary doubles as the fallback for
 * `tl()` lookups; other languages only need the keys they translate.
 * Placeholders use Blockbench's `%0`, `%1`, ... anchors.
 */
export const en = {
  'm3sl.action.name': 'Generate 3D Skin Layers',
  'm3sl.action.description': 'Replace "* Layer" cubes with per-pixel voxel cubes',
  'm3sl.restore_action.name': 'Restore 3D Skin Layers',
  'm3sl.restore_action.description': 'Convert generated 3D skin layer groups back to single cubes',

  'm3sl.dialog.title': 'Generate 3D Skin Layers',
  'm3sl.dialog.intro':
    'Found **%0** layer cube(s) with **%1** visible texel(s). Each texel becomes one cube with all six faces mapped to that pixel (thickness matches the original layer).',
  'm3sl.dialog.warnings_header': 'Warnings:',
  'm3sl.dialog.warnings_more': '... %0 more',

  'm3sl.restore_dialog.title': 'Restore 3D Skin Layers',
  'm3sl.restore_dialog.intro':
    'Found **%0** generated layer group(s) with **%1** voxel cube(s). Restoring recreates the original layer cubes and removes the generated groups.',

  'm3sl.form.use_new_project':
    'Use a new model project (copy the current model and modify the copy; the original stays untouched)',

  'm3sl.form.alpha_threshold': 'Alpha threshold (texels with alpha above this become cubes)',
  'm3sl.form.max_voxels': 'Maximum cube count (run aborts above this)',
  'm3sl.form.batch_size': 'Cubes created per batch',
  'm3sl.form.preserve_original': 'Keep original layer cubes (hide instead of delete)',
  'm3sl.form.replace_empty': 'Replace fully transparent layers with empty groups',
  'm3sl.form.selected_only': 'Only process selected layer cubes',
  'm3sl.form.auto_apply': 'Generate automatically when a project loads',

  'm3sl.toast.generated': 'Generated %0 cubes in %1 layer group(s) (%2s)',
  'm3sl.toast.warnings': '- %0 warning(s), see console',
  'm3sl.toast.no_layers': 'No "* Layer" cubes found - model left unchanged',
  'm3sl.toast.no_restorable_groups': 'No generated 3D skin layer groups found - model left unchanged',
  'm3sl.toast.busy': 'A generation run is already in progress',
  'm3sl.toast.limit':
    'Aborted: run needs %0 cubes, maxVoxels is %1. Raise the limit in the settings dialog if you really want this.',
  'm3sl.toast.edit_mode': 'Switch to Edit mode to generate 3D skin layers',
  'm3sl.toast.open_project': 'Open a project first',
  'm3sl.toast.failed': 'Generation failed: %0',
  'm3sl.toast.restored': 'Restored %0 layer cube(s) and removed %1 voxel cube(s)',
  'm3sl.toast.restore_failed': 'Restore failed: %0',
  'm3sl.toast.edit_mode_restore': 'Switch to Edit mode to restore 3D skin layers',
  'm3sl.toast.copied_note': 'Changes were applied to a copied model; the original is untouched.',

  'm3sl.status.detected':
    '%0 skin layer cube(s) with %1 texels detected - use "Generate 3D Skin Layers" to voxelize',
};

export type TranslationKey = keyof typeof en;

export const zh: Partial<Record<TranslationKey, string>> = {
  'm3sl.action.name': '生成 3D 皮肤层',
  'm3sl.action.description': '将 "* Layer" 立方体替换为逐像素体素方块',
  'm3sl.restore_action.name': '还原 3D 皮肤层',
  'm3sl.restore_action.description': '将已生成的 3D 皮肤层组还原为单个立方体',

  'm3sl.dialog.title': '生成 3D 皮肤层',
  'm3sl.dialog.intro': '找到 **%0** 个皮肤层立方体，共 **%1** 个可见像素。每个像素会生成一个体素方块，六个面都映射到该像素（厚度与原膨胀层一致）。',
  'm3sl.dialog.warnings_header': '警告：',
  'm3sl.dialog.warnings_more': '……另有 %0 条',

  'm3sl.restore_dialog.title': '还原 3D 皮肤层',
  'm3sl.restore_dialog.intro': '找到 **%0** 个已生成的皮肤层分组（共 **%1** 个体素方块）。还原会重建原始皮肤层立方体，并删除生成的分组。',

  'm3sl.form.use_new_project': '使用新模型项目',

  'm3sl.form.alpha_threshold': 'Alpha 阈值（Alpha 高于该值的像素会生成方块）',
  'm3sl.form.max_voxels': '最大方块数量（超过此数量将中止）',
  'm3sl.form.batch_size': '每批创建的方块数量',
  'm3sl.form.preserve_original': '保留原始皮肤层立方体（隐藏而非删除）',
  'm3sl.form.replace_empty': '用空组替换完全透明的皮肤层',
  'm3sl.form.selected_only': '仅处理选中的皮肤层立方体',
  'm3sl.form.auto_apply': '打开项目时自动生成',

  'm3sl.toast.generated': '已生成 %0 个方块（%1 个皮肤层组），耗时 %2 秒',
  'm3sl.toast.warnings': '- %0 条警告，详见控制台',
  'm3sl.toast.no_layers': '未找到 "* Layer" 立方体 —— 模型未做任何修改',
  'm3sl.toast.no_restorable_groups': '未找到可还原的 3D 皮肤层组 —— 模型未做任何修改',
  'm3sl.toast.busy': '已有一次生成正在进行中',
  'm3sl.toast.limit': '已中止：本次需要 %0 个方块，超出上限 %1。如确有需要，请在设置对话框中调高上限。',
  'm3sl.toast.edit_mode': '请先切换到编辑模式再生成 3D 皮肤层',
  'm3sl.toast.open_project': '请先打开一个项目',
  'm3sl.toast.failed': '生成失败：%0',
  'm3sl.toast.restored': '已还原 %0 个皮肤层立方体，并移除 %1 个体素方块',
  'm3sl.toast.restore_failed': '还原失败：%0',
  'm3sl.toast.edit_mode_restore': '请先切换到编辑模式再还原 3D 皮肤层',
  'm3sl.toast.copied_note': '修改已应用到复制出的新模型，原模型保持不变。',

  'm3sl.status.detected': '检测到 %0 个皮肤层立方体（%1 个像素）—— 使用"生成 3D 皮肤层"进行体素化',
};
