import type { GenerationResult, VoxelLimitError } from '../domain/types';
import type { RestoreSummary } from '../blockbench/modelRestorer';
import { t } from '../i18n';

export function toast(text: string, icon = 'view_in_ar'): void {
  Blockbench.showToastNotification({ text, icon });
}

export function status(text: string): void {
  Blockbench.showStatusMessage(text, 4000);
}

export function reportNoLayers(): void {
  toast(t('m3sl.toast.no_layers'), 'info');
}

export function reportNoRestorableGroups(): void {
  toast(t('m3sl.toast.no_restorable_groups'), 'info');
}

export function reportBusy(): void {
  toast(t('m3sl.toast.busy'), 'hourglass_empty');
}

export function reportVoxelLimit(error: VoxelLimitError): void {
  toast(t('m3sl.toast.limit', [error.voxelCount, error.limit]), 'warning');
}

export interface ReportedResult extends GenerationResult {
  warnings: readonly string[];
}

export function reportGenerationResult(result: ReportedResult, note?: string): void {
  const seconds = (result.durationMs / 1000).toFixed(2);
  toast(
    t('m3sl.toast.generated', [result.createdCubes, result.createdGroups, seconds]) +
      (note ? ' ' + note : '') +
      (result.warnings.length ? ' ' + t('m3sl.toast.warnings', [result.warnings.length]) : ''),
    'view_in_ar',
  );
  for (const warning of result.warnings) {
    console.warn(`[minecraft_3d_skin_layers] ${warning}`);
  }
}

export function reportRestoreResult(result: RestoreSummary, note?: string): void {
  toast(t('m3sl.toast.restored', [result.restoredCubes, result.removedVoxels]) + (note ? ' ' + note : ''), 'unarchive');
}

export function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[minecraft_3d_skin_layers] generation failed:', error);
  toast(t('m3sl.toast.failed', [message]), 'error');
}

export function reportRestoreError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[minecraft_3d_skin_layers] restore failed:', error);
  toast(t('m3sl.toast.restore_failed', [message]), 'error');
}
