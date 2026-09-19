import { PLUGIN_ID } from '../domain/constants';
import { t } from '../i18n';
import type { TemplateId, SkinSize } from './templates';
import { TEMPLATE_IDS, SKIN_SIZES } from './templates';

export interface NewSkinWizardSelection {
  template: TemplateId;
  size: SkinSize;
}

/**
 * 新建 3D 皮肤向导：选择模板模型与皮肤纹理尺寸。
 * New 3D skin wizard: pick a template model and the skin texture size.
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
        options: {
          64: '64 × 64',
          128: '128 × 128',
        },
      },
    },
    onConfirm(formResult: unknown) {
      const raw = (formResult ?? {}) as Record<string, unknown>;
      const template = TEMPLATE_IDS.includes(raw.template as TemplateId)
        ? (raw.template as TemplateId)
        : 'classic';
      const size = SKIN_SIZES.includes(raw.size as SkinSize) ? (raw.size as SkinSize) : 64;
      onConfirm({ template, size });
    },
    onClose() {
      onCancel();
    },
  }).show();
}
