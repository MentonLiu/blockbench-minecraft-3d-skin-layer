import { NEW_SKIN_FORMAT_ID } from '../assets/embedded';
import { VoxelLimitError } from '../domain/types';
import { t } from '../i18n';
import { reportError, reportNoLayers, reportVoxelLimit, toast } from '../ui/resultReporter';
import { loadOptions } from '../ui/settingsDialog';
import { applyOutcome, scanAndPlan } from '../generate';
import { suppressAutoScanDuring } from '../blockbench/projectDuplicate';
import { showNewSkinDialog } from './newSkinDialog';
import { buildTemplateModel } from './templates';
import type { SkinSize, TemplateId } from './templates';

let registeredFormat: ModelFormat | undefined;
let creating = false;

/**
 * 等待纹理像素就绪：Blockbench 在 img.onload 里才把图像绘制到 canvas，
 * 解析模板后立即读取像素会得到全 0。data URL 的加载很快，但仍需等待。
 * Waits for texture pixels: Blockbench draws the image onto the canvas only
 * inside img.onload, so reading pixels right after parsing the template would
 * see all zeros. Data URLs load fast but still need the wait.
 */
export async function waitForTexturePixels(texture: Texture): Promise<void> {
  const img = texture.img as HTMLImageElement | undefined;
  if (!img || img.complete) {
    return;
  }
  await new Promise<void>(resolve => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

/** 等待项目全部纹理就绪（带超时兜底）/ Waits for every project texture (with a timeout fallback). */
export async function waitForProjectTextures(timeoutMs = 10_000): Promise<void> {
  const pending = Texture.all.map(texture => waitForTexturePixels(texture));
  if (pending.length === 0) {
    return;
  }
  await Promise.race([
    Promise.all(pending),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * 新建 3D 皮肤项目：空项目 → 解析模板（注入对应尺寸纹理）→ 全像素体素化
 * （透明像素也生成方块，后续用"清除透明方块"清理）。
 * Creates a 3D skin project: empty project → parse the template with the
 * chosen texture → voxelize ALL pixels (transparent ones too; clean up later
 * with "Clear Transparent Cubes").
 */
export async function createSkinProject(template: TemplateId, size: SkinSize): Promise<void> {
  if (creating || !registeredFormat) {
    return;
  }
  creating = true;
  try {
    const { model, projectName } = buildTemplateModel(template, size);
    newProject(registeredFormat);
    // parse 会触发 load_project；此时不能让自动扫描体素化空模板
    // parse fires load_project; the auto-scan must not voxelize the bare template
    suppressAutoScanDuring(() => {
      const parse = Codecs.project.parse;
      if (typeof parse !== 'function') {
        throw new Error('Blockbench project codec cannot parse models');
      }
      parse.call(Codecs.project, model, '');
    });
    Project.name = projectName;
    await waitForProjectTextures();

    const options = { ...loadOptions(), includeTransparent: true };
    const outcome = scanAndPlan(options);
    if (outcome.snapshots.length === 0) {
      reportNoLayers();
      return;
    }
    if (outcome.voxelCount > options.maxVoxels) {
      // 保留未体素化的模板，让用户调高上限后手动生成
      // keep the un-voxelized template so the user can raise the limit and generate manually
      reportVoxelLimit(new VoxelLimitError(outcome.voxelCount, options.maxVoxels));
      return;
    }
    // 新建的皮肤应当可见（模板层立方体可能默认隐藏）
    // the fresh skin must be visible (template layer cubes may be hidden)
    for (const plan of outcome.plans) {
      plan.visibility = true;
    }
    const result = await applyOutcome(outcome, options);
    toast(t('m3sl.toast.wizard_created', [result.createdCubes, (result.durationMs / 1000).toFixed(2)]), 'view_in_ar');
  } catch (error) {
    reportError(error);
  } finally {
    creating = false;
  }
}

function openWizard(): void {
  showNewSkinDialog(
    selection => {
      void createSkinProject(selection.template, selection.size);
    },
    () => undefined,
  );
}

/**
 * 注册"3D 皮肤模型"格式：出现在新建界面与 文件 > 新建 中；
 * 自定义 new() 先弹模板/尺寸向导，而不是直接创建空项目。
 * Registers the "3D Skin Model" format: shown on the start screen and in
 * File > New; the custom new() opens the template/size wizard instead of
 * creating an empty project.
 */
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
