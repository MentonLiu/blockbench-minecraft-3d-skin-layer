import type { GenerationResult, VoxelLimitError } from '../domain/types';

export function toast(text: string, icon = 'view_in_ar'): void {
  Blockbench.showToastNotification({ text, icon });
}

export function status(text: string): void {
  Blockbench.showStatusMessage(text, 4000);
}

export function reportNoLayers(): void {
  toast('No "* Layer" cubes found - model left unchanged', 'info');
}

export function reportBusy(): void {
  toast('A generation run is already in progress', 'hourglass_empty');
}

export function reportVoxelLimit(error: VoxelLimitError): void {
  toast(
    `Aborted: run needs ${error.voxelCount} cubes, maxVoxels is ${error.limit}. ` +
      'Raise the limit in the settings dialog if you really want this.',
    'warning',
  );
}

export interface ReportedResult extends GenerationResult {
  warnings: readonly string[];
}

export function reportGenerationResult(result: ReportedResult): void {
  const seconds = (result.durationMs / 1000).toFixed(2);
  toast(
    `Generated ${result.createdCubes} cubes in ${result.createdGroups} layer group(s) (${seconds}s)` +
      (result.warnings.length ? ` - ${result.warnings.length} warning(s), see console` : ''),
    'view_in_ar',
  );
  for (const warning of result.warnings) {
    console.warn(`[minecraft_3d_skin_layers] ${warning}`);
  }
}

export function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[minecraft_3d_skin_layers] generation failed:', error);
  toast(`Generation failed: ${message}`, 'error');
}
