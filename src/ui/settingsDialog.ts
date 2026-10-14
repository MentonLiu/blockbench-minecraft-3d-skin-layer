import { DEFAULT_OPTIONS, PLUGIN_ID } from '../domain/constants';
import { normalizeGeneratorPreferences, resolveGeneratorOptions } from '../domain/options';
import type { GeneratorOptions, GeneratorPreferences } from '../domain/types';
import { t } from '../i18n';

const STORAGE_KEY = `${PLUGIN_ID}.options`;

export function loadOptions(): GeneratorOptions {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_OPTIONS };
    }
    return resolveGeneratorOptions(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function persistOptions(options: GeneratorOptions | GeneratorPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeGeneratorPreferences(options)));
  } catch {
    // 持久化尽力而为；失败时选项仍在本次会话内可用
    // persistence is best-effort; in-memory options still work for this session
  }
}

export interface GenerationSummary {
  layerCount: number;
  voxelCount: number;
  warnings: readonly string[];
}

/**
 * Preflight dialog: shows what the run will do and lets the user adjust the
 * generation options before anything is modified.
 */
export function showGenerationDialog(
  summary: GenerationSummary,
  options: GeneratorOptions,
  onConfirm: (options: GeneratorOptions) => void,
  onCancel: () => void,
): void {
  // 有警告时在简介下方附上前 5 条 / Append up to five warnings below the intro
  const warningText = summary.warnings.length
    ? `\n\n${t('m3sl.dialog.warnings_header')}\n- ${summary.warnings.slice(0, 5).join('\n- ')}` +
      (summary.warnings.length > 5 ? `\n- ${t('m3sl.dialog.warnings_more', [summary.warnings.length - 5])}` : '')
    : '';

  new Dialog({
    id: `${PLUGIN_ID}.generate_dialog`,
    title: t('m3sl.dialog.title'),
    width: 512,
    form: {
      intro: {
        type: 'info',
        text: t('m3sl.dialog.intro', [summary.layerCount, summary.voxelCount]) + warningText,
      },
      preserveOriginal: {
        label: t('m3sl.form.preserve_original'),
        type: 'checkbox',
        value: options.preserveOriginal,
      },
      replaceEmptyLayer: {
        label: t('m3sl.form.replace_empty'),
        type: 'checkbox',
        value: options.replaceEmptyLayer,
      },
      processSelectedOnly: {
        label: t('m3sl.form.selected_only'),
        type: 'checkbox',
        value: options.processSelectedOnly,
      },
      autoApplyOnLoad: {
        label: t('m3sl.form.auto_apply'),
        type: 'checkbox',
        value: options.autoApplyOnLoad,
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
      onConfirm(resolveGeneratorOptions(raw));
    },
    onClose() {
      onCancel();
    },
  }).show();
}
