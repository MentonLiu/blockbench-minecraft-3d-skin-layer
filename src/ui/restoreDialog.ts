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
      useNewProject: {
        label: t('m3sl.form.use_new_project'),
        type: 'checkbox',
        value: options.targetModel === 'copy',
      },
    },
    onConfirm(formResult: unknown) {
      const raw = { ...options, ...(formResult as Record<string, unknown>) };
      // 底部勾选框：勾选 = 复制为新模型项目并在副本上修改
      // bottom checkbox: checked = duplicate into a new project and edit the copy
      raw.targetModel = (formResult as Record<string, unknown>).useNewProject === true
        ? 'copy'
        : 'current';
      onConfirm(sanitizeOptions(raw));
    },
    onClose() {
      onCancel();
    },
  }).show();
}
