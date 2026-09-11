import { DEFAULT_OPTIONS, PLUGIN_ID } from '../domain/constants';
import type { DepthMode, GeneratorOptions } from '../domain/types';

const STORAGE_KEY = `${PLUGIN_ID}.options`;

const DEPTH_MODES: readonly DepthMode[] = ['preserve_layer', 'pixel', 'fixed'];

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

export function sanitizeOptions(raw: unknown): GeneratorOptions {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const depthMode = DEPTH_MODES.includes(source.depthMode as DepthMode)
    ? (source.depthMode as DepthMode)
    : DEFAULT_OPTIONS.depthMode;
  return {
    alphaThreshold: Math.round(toNumber(source.alphaThreshold, DEFAULT_OPTIONS.alphaThreshold, 0, 255)),
    maxVoxels: Math.round(toNumber(source.maxVoxels, DEFAULT_OPTIONS.maxVoxels, 1, 1_000_000)),
    batchSize: Math.round(toNumber(source.batchSize, DEFAULT_OPTIONS.batchSize, 10, 5000)),
    depthMode,
    fixedDepth: toNumber(source.fixedDepth, DEFAULT_OPTIONS.fixedDepth, 0.01, 16),
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
  const warningText = summary.warnings.length
    ? `\n\nWarnings:\n- ${summary.warnings.slice(0, 5).join('\n- ')}` +
      (summary.warnings.length > 5 ? `\n- ... ${summary.warnings.length - 5} more` : '')
    : '';

  new Dialog({
    id: `${PLUGIN_ID}.generate_dialog`,
    title: 'Generate 3D Skin Layers',
    width: 512,
    form: {
      intro: {
        type: 'text',
        text:
          `Found **${summary.layerCount}** layer cube(s) with **${summary.voxelCount}** visible texel(s).` +
          ` Each texel becomes one cube whose six faces map to that pixel.${warningText}`,
      },
      depthMode: {
        label: 'Voxel depth',
        type: 'select',
        value: options.depthMode,
        options: {
          preserve_layer: 'Match layer inflate (preserves contour)',
          pixel: 'Match texel size (strong voxel look)',
          fixed: 'Fixed thickness',
        },
      },
      fixedDepth: {
        label: 'Fixed thickness (only used in fixed mode)',
        type: 'number',
        value: options.fixedDepth,
        min: 0.01,
        max: 16,
        step: 0.05,
      },
      alphaThreshold: {
        label: 'Alpha threshold (texels with alpha above this become cubes)',
        type: 'number',
        value: options.alphaThreshold,
        min: 0,
        max: 255,
        step: 1,
        force_step: true,
      },
      maxVoxels: {
        label: 'Maximum cube count (run aborts above this)',
        type: 'number',
        value: options.maxVoxels,
        min: 1,
        max: 1_000_000,
        step: 100,
        force_step: true,
      },
      batchSize: {
        label: 'Cubes created per batch',
        type: 'number',
        value: options.batchSize,
        min: 10,
        max: 5000,
        step: 10,
        force_step: true,
      },
      preserveOriginal: {
        label: 'Keep original layer cubes (hide instead of delete)',
        type: 'checkbox',
        value: options.preserveOriginal,
      },
      replaceEmptyLayer: {
        label: 'Replace fully transparent layers with empty groups',
        type: 'checkbox',
        value: options.replaceEmptyLayer,
      },
      processSelectedOnly: {
        label: 'Only process selected layer cubes',
        type: 'checkbox',
        value: options.processSelectedOnly,
      },
      autoApplyOnLoad: {
        label: 'Generate automatically when a project loads',
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
