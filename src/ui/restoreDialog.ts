import { PLUGIN_ID } from '../domain/constants';
import type { GeneratorOptions } from '../domain/types';
import { t } from '../i18n';
import { sanitizeOptions } from './settingsDialog';

export interface RestoreSummaryInfo {
  groupCount: number;
  voxelCount: number;
}

/**
 * Restore preflight dialog: shows how many generated groups will be restored
 * and lets the user pick between modifying the open model or a fresh copy.
 */
export function showRestoreDialog(
  summary: RestoreSummaryInfo,
  options: GeneratorOptions,
  onConfirm: (options: GeneratorOptions) => void,
  onCancel: () => void,
): void {
  new Dialog({
    id: `${PLUGIN_ID}.restore_dialog`,
    title: t('m3sl.restore_dialog.title'),
    width: 512,
    form: {
      intro: {
        type: 'info',
        text: t('m3sl.restore_dialog.intro', [summary.groupCount, summary.voxelCount]),
      },
      targetModel: {
        label: t('m3sl.form.target_model'),
        type: 'select',
        value: options.targetModel,
        options: {
          current: t('m3sl.form.target_model.current'),
          copy: t('m3sl.form.target_model.copy'),
        },
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
