import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, PLUGIN_ID } from '../../src/domain/constants';
import { normalizeGeneratorPreferences, resolveGeneratorOptions } from '../../src/domain/options';
import { loadOptions, persistOptions } from '../../src/ui/settingsDialog';

const STORAGE_KEY = `${PLUGIN_ID}.options`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveGeneratorOptions', () => {
  it('keeps a valid target model selection', () => {
    expect(resolveGeneratorOptions({ targetModel: 'copy' }).targetModel).toBe('copy');
    expect(resolveGeneratorOptions({ targetModel: 'current' }).targetModel).toBe('current');
  });

  it('falls back to the default for unknown target model values', () => {
    expect(resolveGeneratorOptions({ targetModel: 'duplicate' }).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
    expect(resolveGeneratorOptions({ targetModel: 42 }).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
    expect(resolveGeneratorOptions({}).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
    expect(resolveGeneratorOptions(null).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
  });

  it('forces the fixed engineering parameters and preserves other preferences', () => {
    expect(resolveGeneratorOptions({
      alphaThreshold: 128,
      maxVoxels: 1_000_000,
      batchSize: 5000,
      preserveOriginal: true,
      includeTransparent: true,
    })).toEqual({
      ...DEFAULT_OPTIONS,
      preserveOriginal: true,
      includeTransparent: true,
    });
  });

  it('migrates legacy stored values on read without dropping preferences', () => {
    const values = new Map([[STORAGE_KEY, JSON.stringify({
      alphaThreshold: '128',
      maxVoxels: 1_000_000,
      batchSize: 'invalid',
      preserveOriginal: true,
      targetModel: 'copy',
    })]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    expect(loadOptions()).toEqual({
      ...DEFAULT_OPTIONS,
      preserveOriginal: true,
      targetModel: 'copy',
    });
  });

  it('uses defaults when the stored preferences are malformed', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{invalid json',
      setItem: () => undefined,
    });

    expect(loadOptions()).toEqual(DEFAULT_OPTIONS);
  });

  it('persists only user-adjustable preferences', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    persistOptions(resolveGeneratorOptions({
      alphaThreshold: 128,
      maxVoxels: 1_000_000,
      batchSize: 5000,
      preserveOriginal: true,
    }));

    expect(JSON.parse(values.get(STORAGE_KEY)!)).toEqual({
      ...normalizeGeneratorPreferences({ preserveOriginal: true }),
    });
  });
});
