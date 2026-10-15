import { DEFAULT_OPTIONS } from './constants';
import type { GeneratorOptions, GeneratorPreferences } from './types';

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toTargetModel(value: unknown, fallback: 'current' | 'copy'): 'current' | 'copy' {
  return value === 'copy' || value === 'current' ? value : fallback;
}

/** 只读取 UI 仍开放给用户调整的偏好；未知及旧工程参数会被忽略。 */
export function normalizeGeneratorPreferences(raw: unknown): GeneratorPreferences {
  const source = asRecord(raw);
  return {
    preserveOriginal: toBool(source.preserveOriginal, DEFAULT_OPTIONS.preserveOriginal),
    replaceEmptyLayer: toBool(source.replaceEmptyLayer, DEFAULT_OPTIONS.replaceEmptyLayer),
    autoApplyOnLoad: toBool(source.autoApplyOnLoad, DEFAULT_OPTIONS.autoApplyOnLoad),
    processSelectedOnly: toBool(source.processSelectedOnly, DEFAULT_OPTIONS.processSelectedOnly),
    useUVToLocalWhenAvailable: toBool(
      source.useUVToLocalWhenAvailable,
      DEFAULT_OPTIONS.useUVToLocalWhenAvailable,
    ),
    targetModel: toTargetModel(source.targetModel, DEFAULT_OPTIONS.targetModel),
    includeTransparent: toBool(source.includeTransparent, DEFAULT_OPTIONS.includeTransparent),
  };
}

/** 将持久化或表单输入解析为完整运行选项，并强制使用固定工程参数。 */
export function resolveGeneratorOptions(raw: unknown): GeneratorOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...normalizeGeneratorPreferences(raw),
  };
}
