import { VoxelLimitError } from '../domain/types';
import { t } from '../i18n';
import { toSkinOperationError } from '../operations/errors';
import type { SkinOperationName } from '../operations/skinOperations';
import {
  reportBusy,
  reportError,
  reportNoLayers,
  reportNoRegeneratable,
  reportNoRestorableGroups,
  reportRestoreError,
  reportVoxelLimit,
  toast,
} from './resultReporter';

export function reportOperationFailure(error: unknown, operation?: SkinOperationName): void {
  const normalized = toSkinOperationError(error);
  if (normalized.code === 'BUSY') {
    reportBusy();
    return;
  }
  if (normalized.code === 'CANCELLED' || normalized.code === 'PROJECT_CHANGED') {
    toast(t('m3sl.toast.operation_stopped'), 'warning');
    return;
  }
  if (normalized.code === 'NO_PROJECT') {
    toast(t('m3sl.toast.open_project'), 'info');
    return;
  }
  if (normalized.code === 'INVALID_MODE') {
    toast(t(operation === 'restore' ? 'm3sl.toast.edit_mode_restore' : 'm3sl.toast.edit_mode'), 'edit');
    return;
  }
  if (normalized.code === 'NO_TARGETS') {
    if (operation === 'restore') reportNoRestorableGroups();
    else if (operation === 'regenerate') reportNoRegeneratable();
    else reportNoLayers();
    return;
  }
  if (normalized.code === 'VOXEL_LIMIT') {
    const original = error instanceof VoxelLimitError ? error : undefined;
    const count = original?.voxelCount ?? Number(normalized.details?.voxelCount);
    const limit = original?.limit ?? Number(normalized.details?.limit);
    if (Number.isFinite(count) && Number.isFinite(limit)) {
      reportVoxelLimit(new VoxelLimitError(count, limit));
      if (normalized.details?.templateRetainedBare === true) {
        toast(t('m3sl.toast.template_retained'), 'info');
      }
      return;
    }
  }
  if (operation === 'restore') reportRestoreError(normalized);
  else reportError(normalized);
}
