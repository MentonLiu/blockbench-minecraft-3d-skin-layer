import { describe, expect, it } from 'vitest';
import {
  buildTemplateModel,
  parseSkinSize,
  parseTemplateId,
  SKIN_SIZES,
  TEMPLATE_IDS,
  TEMPLATE_UV_SIZE,
} from '../../src/newSkin/templates';
import { NEW_SKIN_FORMAT_ID, TEMP_TEXTURE_DATA_URLS } from '../../src/assets/embedded';

describe('parseSkinSize / parseTemplateId', () => {
  it('accepts numeric and string dialog values for size', () => {
    expect(parseSkinSize(64)).toBe(64);
    expect(parseSkinSize(128)).toBe(128);
    expect(parseSkinSize('64')).toBe(64);
    expect(parseSkinSize('128')).toBe(128);
  });

  it('falls back to 64 for unknown size values', () => {
    expect(parseSkinSize(undefined)).toBe(64);
    expect(parseSkinSize(null)).toBe(64);
    expect(parseSkinSize('')).toBe(64);
    expect(parseSkinSize('96')).toBe(64);
    expect(parseSkinSize('temp-128')).toBe(64);
  });

  it('accepts template ids as strings and falls back to classic', () => {
    expect(parseTemplateId('classic')).toBe('classic');
    expect(parseTemplateId('root')).toBe('root');
    expect(parseTemplateId('joint')).toBe('joint');
    expect(parseTemplateId(undefined)).toBe('classic');
    expect(parseTemplateId('nope')).toBe('classic');
  });

  it('does not mis-detect dialog string sizes via number-array includes', () => {
    // 回归：SKIN_SIZES.includes('128') === false，曾导致 128 静默回退到 temp64
    // Regression: SKIN_SIZES.includes('128') === false once made 128 silently fall back to temp64.
    expect(SKIN_SIZES.includes('128' as never)).toBe(false);
    expect(parseSkinSize('128')).toBe(128);
  });
});

describe('buildTemplateModel', () => {
  it('exposes the three templates and two sizes', () => {
    expect(TEMPLATE_IDS).toEqual(['classic', 'root', 'joint']);
    expect(SKIN_SIZES).toEqual([64, 128]);
  });

  it('deep-copies the template and injects the 64px temp texture', () => {
    const { model, projectName } = buildTemplateModel('root', 64);
    const meta = model.meta as Record<string, unknown>;
    // meta 指向本插件格式，parse 不会把项目切回 free
    // meta points at the plugin format, so parse never falls back to free
    expect(meta.model_format).toBe(NEW_SKIN_FORMAT_ID);
    const textures = model.textures as Array<Record<string, unknown>>;
    expect(textures).toHaveLength(1);
    expect(textures[0].source).toMatch(/^data:image\/png;base64,/);
    expect(textures[0].name).toBe('temp-64.png');
    expect(textures[0].width).toBe(64);
    expect(textures[0].height).toBe(64);
    expect(textures[0].internal).toBe(true);
    expect(textures[0].uv_width).toBe(TEMPLATE_UV_SIZE);
    expect(textures[0].uv_height).toBe(TEMPLATE_UV_SIZE);
    expect(projectName).toBe('temp-64');
  });

  it('injects the 128px temp texture while the UV space stays 64', () => {
    const small = buildTemplateModel('joint', 64);
    const large = buildTemplateModel('joint', 128);
    const smallTexture = (small.model.textures as Array<Record<string, unknown>>)[0];
    const largeTexture = (large.model.textures as Array<Record<string, unknown>>)[0];
    expect(largeTexture.name).toBe('temp-128.png');
    expect(largeTexture.width).toBe(128);
    expect(largeTexture.height).toBe(128);
    expect(largeTexture.uv_width).toBe(64);
    expect(largeTexture.uv_height).toBe(64);
    // 两个尺寸使用不同的 temp 纹理
    // the two sizes use different temp textures
    expect(largeTexture.source).not.toBe(smallTexture.source);
    expect(largeTexture.source).toBe(TEMP_TEXTURE_DATA_URLS[128]);
    expect(smallTexture.source).toBe(TEMP_TEXTURE_DATA_URLS[64]);
    expect(large.projectName).toBe('temp-128');
  });

  it('injects the 128px texture when the size arrives as a dialog string', () => {
    // 新建向导 Dialog 回传 "128"，必须仍然命中 128 纹理而不是 temp-64
    // The wizard Dialog returns "128"; that must still hit the 128 texture, not temp-64.
    const { model, projectName } = buildTemplateModel('classic', '128' as never);
    const texture = (model.textures as Array<Record<string, unknown>>)[0];
    expect(texture.source).toBe(TEMP_TEXTURE_DATA_URLS[128]);
    expect(texture.name).toBe('temp-128.png');
    expect(texture.width).toBe(128);
    expect(texture.height).toBe(128);
    expect(texture.uv_width).toBe(64);
    expect(projectName).toBe('temp-128');
  });

  it('returns independent copies on every call', () => {
    const a = buildTemplateModel('classic', 64);
    const b = buildTemplateModel('classic', 64);
    expect(a.model).not.toBe(b.model);
    const textureA = (a.model.textures as Array<Record<string, unknown>>)[0];
    textureA.width = 999;
    const textureB = (b.model.textures as Array<Record<string, unknown>>)[0];
    expect(textureB.width).toBe(64);
  });

  it('rejects unknown templates and sizes', () => {
    expect(() => buildTemplateModel('nope' as never, 64)).toThrow('Unknown template');
    expect(() => buildTemplateModel('classic', 96 as never)).toThrow('No temp skin texture');
  });
});
