import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { sanitizeOptions } from '../../src/ui/settingsDialog';

describe('sanitizeOptions', () => {
  it('keeps a valid target model selection', () => {
    expect(sanitizeOptions({ targetModel: 'copy' }).targetModel).toBe('copy');
    expect(sanitizeOptions({ targetModel: 'current' }).targetModel).toBe('current');
  });

  it('falls back to the default for unknown target model values', () => {
    expect(sanitizeOptions({ targetModel: 'duplicate' }).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
    expect(sanitizeOptions({ targetModel: 42 }).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
    expect(sanitizeOptions({}).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
    expect(sanitizeOptions(null).targetModel).toBe(DEFAULT_OPTIONS.targetModel);
  });
});
