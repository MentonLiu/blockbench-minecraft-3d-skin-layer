import { PLUGIN_ID } from '../domain/constants';
import type { GeneratorOptions } from '../domain/types';
import { t } from '../i18n';
import { sanitizeOptions } from './settingsDialog';

export interface RegenerateSummaryInfo {
  groupCount: number;
  voxelCount: number;
}

/**
 * 重新生成预检弹窗：显示将重建的分组与方块数量，并让用户选择是否包含
 * 透明像素（默认跟随当前持久化选项）。
 * Regenerate preflight dialog: shows how many groups and cubes the
 * regeneration will produce and lets the user include transparent pixels
 * (defaulting to the persisted option).
 */
export function showRegenerateDialog(
  summary: RegenerateSummaryInfo,
  options: GeneratorOptions,
  onConfirm: (options: GeneratorOptions) => void,
  onCancel: () => void,
): void {
  new Dialog({
    id: `${PLUGIN_ID}.regenerate_dialog`,
    title: t('m3sl.regenerate_dialog.title'),
    width: 512,
    form: {
      intro: {
        type: 'info',
        text: t('m3sl.regenerate_dialog.intro', [summary.groupCount, summary.voxelCount]),
      },
      includeTransparent: {
        label: t('m3sl.form.include_transparent'),
        type: 'checkbox',
        value: options.includeTransparent,
      },
    },
    onConfirm(formResult: unknown) {
      onConfirm(sanitizeOptions({ ...options, ...(formResult as Record<string, unknown>) }));
    },
    onClose() {
      onCancel();
    },
  }).show();
}
