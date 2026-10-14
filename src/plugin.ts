import { GENERATED_SOURCE_PROPERTY, PLUGIN_ID } from './domain/constants';
import { isEditMode, hasOpenProject, hasRestorableGroups, onProjectEvent } from './blockbench/compatibility';
import { isAutoScanSuppressed } from './blockbench/projectDuplicate';
import { hasRegeneratableGroups } from './blockbench/modelRegenerator';
import type { ProjectListener } from './blockbench/compatibility';
import { loadOptions, persistOptions, showGenerationDialog } from './ui/settingsDialog';
import { showRestoreDialog } from './ui/restoreDialog';
import { showRegenerateDialog } from './ui/regenerateDialog';
import { registerNewSkinFormat, unregisterNewSkinFormat } from './newSkin/newSkinFormat';
import { reportOperationFailure } from './ui/operationReporter';
import {
  reportCleared,
  reportGenerationResult,
  reportNoLayers,
  reportNoRestorableGroups,
  reportRegenerated,
  reportRestoreResult,
  status,
} from './ui/resultReporter';
import { t } from './i18n';
import { registerTranslations } from './i18n';
import { skinOperations } from './operations/skinOperations';
import type { SkinOperationResult } from './operations/skinOperations';
import { registerMcpTools, unregisterMcpTools } from './mcp/registerTools';

export type { ScanOutcome } from './generate';

function confirmGeneration(
  preview: { groupCount: number; voxelCount: number; warnings: string[] },
  options: ReturnType<typeof loadOptions>,
): Promise<ReturnType<typeof loadOptions> | null> {
  return new Promise(resolve => {
    showGenerationDialog(
      { layerCount: preview.groupCount, voxelCount: preview.voxelCount, warnings: preview.warnings },
      options,
      merged => {
        persistOptions(merged);
        resolve(merged);
      },
      () => resolve(null),
    );
  });
}

function confirmRestore(
  preview: { groupCount: number; voxelCount: number },
  options: ReturnType<typeof loadOptions>,
): Promise<ReturnType<typeof loadOptions> | null> {
  return new Promise(resolve => {
    showRestoreDialog(
      { groupCount: preview.groupCount, voxelCount: preview.voxelCount },
      options,
      merged => {
        persistOptions(merged);
        resolve(merged);
      },
      () => resolve(null),
    );
  });
}

function confirmRegenerate(
  preview: { groupCount: number; voxelCount: number },
  options: ReturnType<typeof loadOptions>,
): Promise<ReturnType<typeof loadOptions> | null> {
  return new Promise(resolve => {
    showRegenerateDialog(
      { groupCount: preview.groupCount, voxelCount: preview.voxelCount },
      options,
      merged => {
        persistOptions(merged);
        resolve(merged);
      },
      () => resolve(null),
    );
  });
}

function reportGeneration(result: SkinOperationResult): void {
  if (result.status === 'cancelled') return;
  if (result.status === 'detected') {
    status(t('m3sl.status.detected', [result.sourceCount, result.plannedCubes]));
    return;
  }
  if (result.sourceCount === 0) {
    reportNoLayers();
    return;
  }
  reportGenerationResult(
    { createdCubes: result.createdCubes, createdGroups: result.createdGroups, durationMs: result.durationMs, warnings: result.warnings },
    result.copiedProject ? t('m3sl.toast.copied_note') : undefined,
  );
}

async function runGeneration(auto: boolean): Promise<void> {
  const result = await skinOperations.generate({
    options: loadOptions(),
    auto,
    confirm: auto ? undefined : confirmGeneration,
  });
  reportGeneration(result);
}

async function runRestore(): Promise<void> {
  const result = await skinOperations.restore({ options: loadOptions(), confirm: confirmRestore });
  if (result.status === 'cancelled') return;
  if (result.restoredCubes === 0) {
    reportNoRestorableGroups();
    return;
  }
  reportRestoreResult(
    { restoredCubes: result.restoredCubes, restoredGroups: result.restoredCubes, removedVoxels: result.removedCubes },
    result.copiedProject ? t('m3sl.toast.copied_note') : undefined,
  );
}

async function runRegenerate(): Promise<void> {
  const result = await skinOperations.regenerate({ options: loadOptions(), confirm: confirmRegenerate });
  if (result.status === 'cancelled') return;
  reportRegenerated({
    replacedGroups: result.replacedGroups,
    createdCubes: result.createdCubes,
    durationMs: result.durationMs,
    warnings: result.warnings,
  });
}

async function runClearTransparent(): Promise<void> {
  const result = await skinOperations.clearTransparent({ options: loadOptions() });
  reportCleared({ removed: result.removedCubes, warnings: result.warnings });
}

async function guarded(
  operation: () => Promise<void>,
  name: 'generate' | 'restore' | 'regenerate' | 'clear_transparent',
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    reportOperationFailure(error, name);
  }
}

function onProjectLoaded(): ProjectListener {
  return () => {
    // Parsing a copied project emits load_project; its explicit operation already owns the lease.
    if (isAutoScanSuppressed()) return;
    void guarded(() => runGeneration(true), 'generate');
  };
}

let actions: Action[] = [];
let listeners: { dispose(): void }[] = [];
let generatedSourceProperty: Property | undefined;
let skinMenu: BarMenu | undefined;

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
    click: () => { void guarded(() => runGeneration(false), 'generate'); },
  });
  const restoreAction = new Action(`${PLUGIN_ID}.restore`, {
    name: t('m3sl.restore_action.name'),
    description: t('m3sl.restore_action.description'),
    icon: 'unarchive',
    category: 'edit',
    condition: () => isEditMode() && hasOpenProject() && hasRestorableGroups(),
    click: () => { void guarded(runRestore, 'restore'); },
  });
  const clearTransparentAction = new Action(`${PLUGIN_ID}.clear_transparent`, {
    name: t('m3sl.clear_action.name'),
    description: t('m3sl.clear_action.description'),
    icon: 'layers_clear',
    category: 'edit',
    condition: () => hasOpenProject(),
    click: () => { void guarded(runClearTransparent, 'clear_transparent'); },
  });
  const regenerateAction = new Action(`${PLUGIN_ID}.regenerate`, {
    name: t('m3sl.regenerate_action.name'),
    description: t('m3sl.regenerate_action.description'),
    icon: 'autorenew',
    category: 'edit',
    condition: () => hasOpenProject() && hasRegeneratableGroups(),
    click: () => { void guarded(runRegenerate, 'regenerate'); },
  });
  actions = [generateAction, restoreAction, clearTransparentAction, regenerateAction];

  skinMenu = new BarMenu(
    `${PLUGIN_ID}.menu`,
    [
      `${PLUGIN_ID}.generate`,
      `${PLUGIN_ID}.regenerate`,
      `${PLUGIN_ID}.restore`,
      `${PLUGIN_ID}.clear_transparent`,
    ],
    { name: 'm3sl.menu.name', condition: () => hasOpenProject(), icon: 'view_in_ar' },
  );
  MenuBar.addMenu(skinMenu, 'file');
  registerNewSkinFormat();
  listeners = [onProjectEvent('load_project', onProjectLoaded())];
  registerMcpTools();
}

export function unregisterPlugin(): void {
  unregisterMcpTools();
  skinOperations.coordinator.cancelActive('Plugin disabled');
  for (const listener of listeners) listener.dispose();
  listeners = [];
  unregisterNewSkinFormat();
  if (skinMenu && typeof skinMenu.delete === 'function') {
    skinMenu.delete();
    MenuBar.update();
  }
  skinMenu = undefined;
  for (const action of actions) action.delete();
  actions = [];
  generatedSourceProperty?.delete();
  generatedSourceProperty = undefined;
}
