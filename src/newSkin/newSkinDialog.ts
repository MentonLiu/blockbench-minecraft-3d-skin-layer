import { PLUGIN_ID } from '../domain/constants';
import { t } from '../i18n';
import type { TemplateId, SkinSize } from './templates';
import { parseOptionalText, parseSkinSize, parseTemplateId } from './templates';

export interface NewSkinWizardSelection {
  template: TemplateId;
  size: SkinSize;
  /** 可选项目名，留空保持默认 temp-<尺寸> / Optional project name; empty keeps temp-<size>. */
  name?: string;
  /** 可选模型标识符，留空不设置 / Optional model identifier; empty leaves it unset. */
  identifier?: string;
}

/**
 * 新建 3D 皮肤向导：选择模板模型与皮肤纹理尺寸；
 * 模型名称与标识符可自由填写，也可留空。
 * New 3D skin wizard: pick a template model and the skin texture size;
 * model name and identifier are free-form and may be left empty.
 */
export function showNewSkinDialog(
  onConfirm: (selection: NewSkinWizardSelection) => void,
  onCancel: () => void,
): void {
  new Dialog({
    id: `${PLUGIN_ID}.new_skin_dialog`,
    title: t('m3sl.wizard.title'),
    width: 512,
    form: {
      intro: { type: 'info', text: t('m3sl.wizard.intro') },
      template: {
        label: t('m3sl.wizard.template'),
        type: 'select',
        value: 'classic',
        options: {
          classic: t('m3sl.wizard.template.classic'),
          root: t('m3sl.wizard.template.root'),
          joint: t('m3sl.wizard.template.joint'),
        },
      },
      size: {
        label: t('m3sl.wizard.size'),
        type: 'select',
        value: '64',
        // 键必须是字符串：Dialog select 回传的就是字符串，写成数字键不会改变这一点
        // Keys must be strings: Dialog select values are strings either way.
        options: {
          '64': '64 × 64',
          '128': '128 × 128',
        },
      },
      name: {
        label: t('m3sl.wizard.name'),
        type: 'text',
        placeholder: t('m3sl.wizard.name.placeholder'),
      },
      identifier: {
        label: t('m3sl.wizard.identifier'),
        type: 'text',
        placeholder: t('m3sl.wizard.identifier.placeholder'),
      },
    },
    onConfirm(formResult: unknown) {
      const raw = (formResult ?? {}) as Record<string, unknown>;
      // Dialog 回传可能是 "128"/"classic" 等字符串；统一走 parse*，避免 includes 数字数组失败
      // Dialog results may be strings ("128"/"classic"); always parse instead of includes() on number arrays.
      onConfirm({
        template: parseTemplateId(raw.template),
        size: parseSkinSize(raw.size),
        name: parseOptionalText(raw.name),
        identifier: parseOptionalText(raw.identifier),
      });
    },
    onClose() {
      onCancel();
    },
  }).show();
}
