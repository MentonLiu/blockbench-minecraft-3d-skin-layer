import { EMBEDDED_TEMPLATES, TEMP_TEXTURE_DATA_URLS } from '../assets/embedded';
import { NEW_SKIN_FORMAT_ID } from '../assets/embedded';

export type TemplateId = 'classic' | 'root' | 'joint';
export type SkinSize = 64 | 128;

export const TEMPLATE_IDS: readonly TemplateId[] = ['classic', 'root', 'joint'];
export const SKIN_SIZES: readonly SkinSize[] = [64, 128];

/** UV 空间固定 64：128 纹理即 2 倍像素密度 / UV space stays 64; a 128 texture doubles texel density. */
export const TEMPLATE_UV_SIZE = 64;

/**
 * 解析向导中的模板 id。
 * Normalizes a wizard template id.
 */
export function parseTemplateId(value: unknown): TemplateId {
  return TEMPLATE_IDS.includes(value as TemplateId) ? (value as TemplateId) : 'classic';
}

/**
 * 解析向导中的皮肤纹理尺寸。
 * Blockbench Dialog 的 select 回传值是字符串（"128"），不能直接对 number 数组做 includes。
 * Normalizes a wizard skin size. Dialog select values arrive as strings ("128"),
 * so a numeric-array includes() check would always fail and silently fall back to 64.
 */
export function parseSkinSize(value: unknown): SkinSize {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return n === 128 ? 128 : 64;
}

/**
 * 解析向导中的可选文本输入（模型名称 / 标识符）：去掉首尾空白，空白视为未填写。
 * Normalizes an optional wizard text input (model name / identifier): trims
 * whitespace, blank input counts as unset.
 */
export function parseOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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
  // 模板 id 保持严格查找：未知 id 必须报错，不能被 parse 回退成 classic
  // Template id stays strict: unknown ids must throw, not silently fall back via parse*.
  const source = EMBEDDED_TEMPLATES[id];
  if (!source) {
    throw new Error(`Unknown template: ${id}`);
  }
  // Dialog 回传可能是 "128"；仅把可解析的字符串尺寸转成 number，未知值仍进入查表并失败
  // Dialog results may be "128"; coerce parseable string sizes only — unknown values still fail the lookup.
  const numericSize = typeof size === 'number' ? size : Number(String(size ?? '').trim());
  const dataUrl = TEMP_TEXTURE_DATA_URLS[numericSize];
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
      texture.name = `temp-${numericSize}.png`;
      texture.width = numericSize;
      texture.height = numericSize;
      // UV 空间保持 64，128 图像才会得到 2 倍 texel 密度
      // Keep the UV space at 64 so a 128 image yields 2x texel density.
      texture.uv_width = TEMPLATE_UV_SIZE;
      texture.uv_height = TEMPLATE_UV_SIZE;
      texture.internal = true;
    }
  }
  if (model.meta) {
    model.meta.model_format = NEW_SKIN_FORMAT_ID;
  }
  return { model: model as Record<string, unknown>, projectName: `temp-${numericSize}` };
}
