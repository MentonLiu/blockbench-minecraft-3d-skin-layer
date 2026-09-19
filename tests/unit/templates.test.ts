import { describe, expect, it } from 'vitest';
import { buildTemplateModel, SKIN_SIZES, TEMPLATE_IDS } from '../../src/newSkin/templates';
import { NEW_SKIN_FORMAT_ID } from '../../src/assets/embedded';

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
    expect(textures[0].width).toBe(64);
    expect(textures[0].height).toBe(64);
    expect(textures[0].internal).toBe(true);
    expect(textures[0].uv_width).toBe(64);
    expect(projectName).toBe('temp-64');
  });

  it('injects the 128px temp texture while the UV space stays 64', () => {
    const small = buildTemplateModel('joint', 64);
    const large = buildTemplateModel('joint', 128);
    const smallTexture = (small.model.textures as Array<Record<string, unknown>>)[0];
    const largeTexture = (large.model.textures as Array<Record<string, unknown>>)[0];
    expect(largeTexture.width).toBe(128);
    expect(largeTexture.height).toBe(128);
    expect(largeTexture.uv_width).toBe(64);
    // 两个尺寸使用不同的 temp 纹理
    // the two sizes use different temp textures
    expect(largeTexture.source).not.toBe(smallTexture.source);
    expect(large.projectName).toBe('temp-128');
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
