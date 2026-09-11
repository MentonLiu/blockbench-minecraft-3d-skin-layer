import { describe, expect, it } from 'vitest';
import { en, zh } from '../../src/i18n/strings';

describe('translation catalog', () => {
  it('provides a non-empty English string for every key', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('only translates known English keys (zh is a subset)', () => {
    for (const key of Object.keys(zh)) {
      expect(en, key).toHaveProperty(key);
    }
  });

  it('translates every key into Chinese', () => {
    const missing = Object.keys(en).filter(key => !(key in zh));
    expect(missing).toEqual([]);
  });

  it('keeps placeholder anchors consistent between languages', () => {
    for (const [key, english] of Object.entries(en)) {
      const anchors = (text: string) => (text.match(/%\d/g) ?? []).sort().join(',');
      const zhValue = zh[key as keyof typeof zh];
      if (zhValue === undefined) {
        continue;
      }
      expect(anchors(zhValue), key).toBe(anchors(english));
    }
  });

  it('has no stray translation markup in values', () => {
    for (const [key, value] of Object.entries({ ...en, ...zh })) {
      expect(value.includes('undefined'), key).toBe(false);
    }
  });
});
