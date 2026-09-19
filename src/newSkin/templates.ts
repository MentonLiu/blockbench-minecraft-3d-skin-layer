import { EMBEDDED_TEMPLATES, TEMP_TEXTURE_DATA_URLS } from '../assets/embedded';
import { NEW_SKIN_FORMAT_ID } from '../assets/embedded';

export type TemplateId = 'classic' | 'root' | 'joint';
export type SkinSize = 64 | 128;

export const TEMPLATE_IDS: readonly TemplateId[] = ['classic', 'root', 'joint'];
export const SKIN_SIZES: readonly SkinSize[] = [64, 128];

export interface TemplateModelBuild {
  /** 可直接交给 Codecs.project.parse 的 bbmodel JSON / bbmodel JSON ready for Codecs.project.parse. */
  model: Record<string, unknown>;
  /** 注入纹理后的项目名 / Project name after the texture injection. */
  projectName: string;
}

/**
 * 从嵌入模板构建可解析的 bbmodel：深拷贝并注入所选尺寸的 temp 皮肤纹理
 * （纹理 64/128 图像，UV 空间保持 64，128 即 2 倍像素密度）。
 * meta.model_format 在嵌入时已指向本插件格式，parse 不会把项目切回 free。
 * Builds a parseable bbmodel from an embedded template: deep copy plus the
 * temp skin texture of the chosen size (64/128 image over a 64 UV space, so
 * 128 doubles the texel density). meta.model_format was patched to this
 * plugin's format at embed time, so parse never falls back to `free`.
 */
export function buildTemplateModel(id: TemplateId, size: SkinSize): TemplateModelBuild {
  const source = EMBEDDED_TEMPLATES[id];
  if (!source) {
    throw new Error(`Unknown template: ${id}`);
  }
  const dataUrl = TEMP_TEXTURE_DATA_URLS[size];
  if (!dataUrl) {
    throw new Error(`No temp skin texture embedded for size ${size}`);
  }
  const model = JSON.parse(JSON.stringify(source)) as {
    meta?: Record<string, unknown>;
    textures?: Array<Record<string, unknown>>;
  };
  if (Array.isArray(model.textures)) {
    for (const texture of model.textures) {
      texture.source = dataUrl;
      texture.width = size;
      texture.height = size;
      texture.internal = true;
    }
  }
  if (model.meta) {
    model.meta.model_format = NEW_SKIN_FORMAT_ID;
  }
  return { model: model as Record<string, unknown>, projectName: `temp-${size}` };
}
