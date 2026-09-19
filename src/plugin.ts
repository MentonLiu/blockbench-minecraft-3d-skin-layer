import { GENERATED_SOURCE_PROPERTY, PLUGIN_ID } from './domain/constants';
import { VoxelLimitError } from './domain/types';
import type { GeneratorOptions } from './domain/types';
import { applyOutcome, scanAndPlan } from './generate';
import { registerTranslations, t } from './i18n';
import {
  collectRestoreCandidates,
  hasOpenProject,
  hasRestorableGroups,
  isEditMode,
  onProjectEvent,
} from './blockbench/compatibility';
import type { ProjectListener } from './blockbench/compatibility';
import { applyRestores } from './blockbench/modelRestorer';
import {
  blockbenchDuplicateHost,
  duplicateCurrentProjectAsCopy,
  isAutoScanSuppressed,
} from './blockbench/projectDuplicate';
import { blockbenchHost } from './blockbench/blockbenchHost';
import { loadOptions, persistOptions, showGenerationDialog } from './ui/settingsDialog';
import { showRestoreDialog } from './ui/restoreDialog';
import { registerNewSkinFormat, unregisterNewSkinFormat } from './newSkin/newSkinFormat';
import {
  reportBusy,
  reportError,
  reportGenerationResult,
  reportNoRestorableGroups,
  reportRestoreError,
  reportRestoreResult,
  reportNoLayers,
  reportVoxelLimit,
  status,
  toast,
} from './ui/resultReporter';
import { logger } from './infra/logger';

export type { ScanOutcome } from './generate';

async function runGeneration(auto: boolean): Promise<void> {
  if (!isEditMode()) {
    if (!auto) {
      toast(t('m3sl.toast.edit_mode'), 'edit');
    }
    return;
  }
  if (!hasOpenProject()) {
    if (!auto) {
      toast(t('m3sl.toast.open_project'), 'info');
    }
    return;
  }

  const options = loadOptions();
  const outcome = scanAndPlan(options);

  if (outcome.snapshots.length === 0) {
    if (!auto) {
      reportNoLayers();
    }
    return;
  }
  if (outcome.voxelCount > options.maxVoxels) {
    reportVoxelLimit(new VoxelLimitError(outcome.voxelCount, options.maxVoxels));
    return;
  }

  if (auto && !options.autoApplyOnLoad) {
    status(t('m3sl.status.detected', [outcome.snapshots.length, outcome.voxelCount]));
    return;
  }

  if (auto) {
    const result = await applyOutcome(outcome, options);
    reportGenerationResult({ ...result, warnings: outcome.warnings });
    return;
  }

  const confirmed = await new Promise<GeneratorOptions | null>(resolve => {
    showGenerationDialog(
      { layerCount: outcome.snapshots.length, voxelCount: outcome.voxelCount, warnings: outcome.warnings },
      options,
      merged => {
        persistOptions(merged);
        resolve(merged);
      },
      () => resolve(null),
    );
  });
  if (!confirmed) {
    return;
  }

  // 用确认后的选项重新扫描：对话框里可能改了 alpha 阈值等参数，
  // 对话框之前的计划已经过期。此次扫描也作为复制/应用前的最终预检。
  // Re-plan with the confirmed options: the dialog may have changed the alpha
  // threshold etc., so the pre-dialog plan is stale. This scan also serves as
  // the final preflight before copying/applying.
  const fresh = scanAndPlan(confirmed);
  if (fresh.snapshots.length === 0) {
    reportNoLayers();
    return;
  }
  if (fresh.voxelCount > confirmed.maxVoxels) {
    reportVoxelLimit(new VoxelLimitError(fresh.voxelCount, confirmed.maxVoxels));
    return;
  }

  // 复制模式：先把当前项目复制成新标签页（副本成为活动项目），再在副本上
  // 应用计划——计划是纯数据 + uuid，写入时会解析到活动项目的元素。
  // Copy mode: duplicate the open project into a new tab (the copy becomes the
  // active project), then apply the plans there - plans are plain data plus
  // uuids, resolved against the active project at write time.
  const appliedToCopy = confirmed.targetModel === 'copy';
  if (appliedToCopy) {
    duplicateCurrentProjectAsCopy(blockbenchDuplicateHost, ' - 3D Layers');
  }

  const result = await applyOutcome(fresh, confirmed);
  reportGenerationResult(
    { ...result, warnings: fresh.warnings },
    appliedToCopy ? t('m3sl.toast.copied_note') : undefined,
  );
}

let running = false;

async function runGenerationGuarded(auto: boolean): Promise<void> {
  if (running) {
    reportBusy();
    return;
  }
  running = true;
  try {
    await runGeneration(auto);
  } catch (error) {
    if (error instanceof VoxelLimitError) {
      reportVoxelLimit(error);
    } else {
      logger.error('generation failed', error);
      reportError(error);
    }
  } finally {
    running = false;
  }
}

async function runRestore(): Promise<void> {
  if (!isEditMode()) {
    toast(t('m3sl.toast.edit_mode_restore'), 'edit');
    return;
  }
  if (!hasOpenProject()) {
    toast(t('m3sl.toast.open_project'), 'info');
    return;
  }
  const candidates = collectRestoreCandidates();
  if (candidates.length === 0) {
    reportNoRestorableGroups();
    return;
  }

  const voxelCount = candidates.reduce((sum, candidate) => sum + candidate.children.length, 0);
  const confirmed = await new Promise<GeneratorOptions | null>(resolve => {
    showRestoreDialog(
      { groupCount: candidates.length, voxelCount },
      loadOptions(),
      merged => {
        persistOptions(merged);
        resolve(merged);
      },
      () => resolve(null),
    );
  });
  if (!confirmed) {
    return;
  }

  // 复制模式：先复制项目（副本成为活动项目），再在副本上执行还原。
  // 候选持有旧项目的活动对象引用，必须在副本上重新收集。
  // Copy mode: duplicate first (the copy becomes the active project), then
  // restore there. Candidates hold live references to the old project's
  // objects, so they must be re-collected in the copy.
  const appliedToCopy = confirmed.targetModel === 'copy';
  if (appliedToCopy) {
    duplicateCurrentProjectAsCopy(blockbenchDuplicateHost, ' - Restored');
  }
  const activeCandidates = collectRestoreCandidates();
  if (activeCandidates.length === 0) {
    reportNoRestorableGroups();
    return;
  }
  const result = applyRestores(activeCandidates, blockbenchHost);
  reportRestoreResult(
    result,
    appliedToCopy ? t('m3sl.toast.copied_note') : undefined,
  );
}

async function runRestoreGuarded(): Promise<void> {
  if (running) {
    reportBusy();
    return;
  }
  running = true;
  try {
    await runRestore();
  } catch (error) {
    reportRestoreError(error);
  } finally {
    running = false;
  }
}

let actions: Action[] = [];
let listeners: { dispose(): void }[] = [];
let generatedSourceProperty: Property | undefined;

function onProjectLoaded(): ProjectListener {
  return () => {
    // 项目复制过程中的 parse 会触发 load_project；此时必须抑制自动扫描，
    // 否则刚复制出的副本会被误体素化
    // parsing during project duplication fires load_project; the auto-scan
    // must stay suppressed then, or the fresh copy would be voxelized
    // unintendedly
    if (isAutoScanSuppressed()) {
      return;
    }
    void runGenerationGuarded(true);
  };
}

export function registerPlugin(): void {
  registerTranslations();
  generatedSourceProperty = new Property(Group, 'object', GENERATED_SOURCE_PROPERTY, {
    default: null,
    export: true,
    copy_value: true,
  });

  const generateAction = new Action(`${PLUGIN_ID}.generate`, {
    name: t('m3sl.action.name'),
    description: t('m3sl.action.description'),
    icon: 'view_in_ar',
    category: 'edit',
    condition: () => isEditMode() && hasOpenProject(),
    click: () => {
      void runGenerationGuarded(false);
    },
  });
  const restoreAction = new Action(`${PLUGIN_ID}.restore`, {
    name: t('m3sl.restore_action.name'),
    description: t('m3sl.restore_action.description'),
    icon: 'unarchive',
    category: 'edit',
    condition: () => isEditMode() && hasOpenProject() && hasRestorableGroups(),
    click: () => {
      void runRestoreGuarded();
    },
  });
  actions = [generateAction, restoreAction];
  // Blockbench 不会自动把插件动作插入菜单栏，这里显式挂到编辑菜单
  // plugin actions are not added to menus automatically; place it in Edit
  MenuBar.addAction(generateAction, 'edit');
  MenuBar.addAction(restoreAction, 'edit');

  registerNewSkinFormat();

  listeners = [onProjectEvent('load_project', onProjectLoaded())];
}

export function unregisterPlugin(): void {
  for (const listener of listeners) {
    listener.dispose();
  }
  listeners = [];
  MenuBar.removeAction(`edit.${PLUGIN_ID}.generate`);
  MenuBar.removeAction(`edit.${PLUGIN_ID}.restore`);
  unregisterNewSkinFormat();
  for (const action of actions) {
    action.delete();
  }
  actions = [];
  generatedSourceProperty?.delete();
  generatedSourceProperty = undefined;
}
