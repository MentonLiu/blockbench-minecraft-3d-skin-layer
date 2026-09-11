import { DEFAULT_OPTIONS, PLUGIN_ID } from '../domain/constants';
import type { GeneratorOptions } from '../domain/types';
import { t } from '../i18n';

const STORAGE_KEY = `${PLUGIN_ID}.options`;

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 清洗并校验用户输入，得到合法的生成选项 / Validate raw input into legal options. */
export function sanitizeOptions(raw: unknown): GeneratorOptions {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    alphaThreshold: Math.round(toNumber(source.alphaThreshold, DEFAULT_OPTIONS.alphaThreshold, 0, 255)),
    maxVoxels: Math.round(toNumber(source.maxVoxels, DEFAULT_OPTIONS.maxVoxels, 1, 1_000_000)),
    batchSize: Math.round(toNumber(source.batchSize, DEFAULT_OPTIONS.batchSize, 10, 5000)),
    preserveOriginal: toBool(source.preserveOriginal, DEFAULT_OPTIONS.preserveOriginal),
    replaceEmptyLayer: toBool(source.replaceEmptyLayer, DEFAULT_OPTIONS.replaceEmptyLayer),
    autoApplyOnLoad: toBool(source.autoApplyOnLoad, DEFAULT_OPTIONS.autoApplyOnLoad),
    processSelectedOnly: toBool(source.processSelectedOnly, DEFAULT_OPTIONS.processSelectedOnly),
    useUVToLocalWhenAvailable: toBool(
      source.useUVToLocalWhenAvailable,
      DEFAULT_OPTIONS.useUVToLocalWhenAvailable,
    ),
  };
}

export function loadOptions(): GeneratorOptions {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_OPTIONS };
    }
    return sanitizeOptions(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function persistOptions(options: GeneratorOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
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
      alphaThreshold: {
        label: t('m3sl.form.alpha_threshold'),
        type: 'number',
        value: options.alphaThreshold,
        min: 0,
        max: 255,
        step: 1,
        force_step: true,
      },
      maxVoxels: {
        label: t('m3sl.form.max_voxels'),
        type: 'number',
        value: options.maxVoxels,
        min: 1,
        max: 1_000_000,
        step: 100,
        force_step: true,
      },
      batchSize: {
        label: t('m3sl.form.batch_size'),
        type: 'number',
        value: options.batchSize,
        min: 10,
        max: 5000,
        step: 10,
        force_step: true,
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
    },
    onConfirm(formResult: unknown) {
      onConfirm(sanitizeOptions({ ...options, ...(formResult as Record<string, unknown>) }));
    },
    onClose() {
      onCancel();
    },
  }).show();
}
