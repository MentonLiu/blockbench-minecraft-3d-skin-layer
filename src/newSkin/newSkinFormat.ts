import { NEW_SKIN_FORMAT_ID } from '../assets/embedded';
import { t } from '../i18n';
import { reportOperationFailure } from '../ui/operationReporter';
import { reportNoLayers, toast } from '../ui/resultReporter';
import { suppressAutoScanDuring } from '../blockbench/projectDuplicate';
import { showNewSkinDialog } from './newSkinDialog';
import { buildTemplateModel } from './templates';
import type { SkinSize, SkinType, TemplateId } from './templates';
import { skinOperations } from '../operations/skinOperations';

let registeredFormat: ModelFormat | undefined;

/** Waits for Blockbench to finish drawing a loaded texture into its pixel canvas. */
export async function waitForTexturePixels(texture: Texture): Promise<void> {
  const img = texture.img as HTMLImageElement | undefined;
  if (!img || img.complete) return;
  await new Promise<void>(resolve => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

/** Waits for project textures, with a timeout fallback for broken image events. */
export async function waitForProjectTextures(timeoutMs = 10_000): Promise<void> {
  const pending = Texture.all.map(texture => waitForTexturePixels(texture));
  if (!pending.length) return;
  await Promise.race([
    Promise.all(pending),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

/** UI adapter for creating a new skin; the shared operation owns the write lease. */
export async function createSkinProject(
  skinType: SkinType,
  template: TemplateId,
  size: SkinSize,
  name?: string,
  identifier?: string,
): Promise<void> {
  if (!registeredFormat) return;
  try {
    const result = await skinOperations.newSkin({
      skinType,
      template,
      size,
      name,
      identifier,
      createTemplateProject() {
        const { model, projectName } = buildTemplateModel(skinType, template, size);
        // Both creation and parsing can emit load_project; keep the shared lease from
        // triggering the automatic generator while the template is being prepared.
        suppressAutoScanDuring(() => {
          if (!newProject(registeredFormat as ModelFormat)) {
            throw new Error('Blockbench could not create the template project');
          }
          const parse = Codecs.project.parse;
          if (typeof parse !== 'function') {
            throw new Error('Blockbench project codec cannot parse models');
          }
          parse.call(Codecs.project, model, '');
        });
        return { projectName };
      },
      waitForTextures: () => waitForProjectTextures(),
    });
    if (result.status === 'template_retained') {
      reportNoLayers();
      return;
    }
    toast(t('m3sl.toast.wizard_created', [result.createdCubes, (result.durationMs / 1000).toFixed(2)]), 'view_in_ar');
  } catch (error) {
    reportOperationFailure(error, 'new_skin');
  }
}

function openWizard(): void {
  showNewSkinDialog(
    selection => {
      void createSkinProject(
        selection.skinType,
        selection.template,
        selection.size,
        selection.name,
        selection.identifier,
      );
    },
    () => undefined,
  );
}

/** Registers the custom format and routes its New action through the shared service. */
export function registerNewSkinFormat(): void {
  registeredFormat = new ModelFormat(NEW_SKIN_FORMAT_ID, {
    icon: 'view_in_ar',
    category: 'minecraft',
    name: t('m3sl.format.name'),
    description: t('m3sl.format.description'),
    rotate_cubes: true,
    bone_rig: true,
    centered_grid: true,
    optional_box_uv: true,
    uv_rotation: true,
    animation_mode: true,
    new: () => {
      openWizard();
      return true;
    },
  });
}

export function unregisterNewSkinFormat(): void {
  if (registeredFormat && typeof registeredFormat.delete === 'function') {
    registeredFormat.delete();
  }
  registeredFormat = undefined;
}
