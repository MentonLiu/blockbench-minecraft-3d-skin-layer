import type { GenerationResult, VoxelLimitError } from '../domain/types';
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

export function reportBusy(): void {
  toast(t('m3sl.toast.busy'), 'hourglass_empty');
}

export function reportVoxelLimit(error: VoxelLimitError): void {
  toast(t('m3sl.toast.limit', [error.voxelCount, error.limit]), 'warning');
}

export interface ReportedResult extends GenerationResult {
  warnings: readonly string[];
}

export function reportGenerationResult(result: ReportedResult): void {
  const seconds = (result.durationMs / 1000).toFixed(2);
  toast(
    t('m3sl.toast.generated', [result.createdCubes, result.createdGroups, seconds]) +
      (result.warnings.length ? ' ' + t('m3sl.toast.warnings', [result.warnings.length]) : ''),
    'view_in_ar',
  );
  for (const warning of result.warnings) {
    console.warn(`[minecraft_3d_skin_layers] ${warning}`);
  }
}

export function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[minecraft_3d_skin_layers] generation failed:', error);
  toast(t('m3sl.toast.failed', [message]), 'error');
}
