import { VoxelLimitError } from '../domain/types';

export type SkinOperationErrorCode =
  | 'BUSY'
  | 'NO_PROJECT'
  | 'INVALID_MODE'
  | 'VOXEL_LIMIT'
  | 'NO_TARGETS'
  | 'PROJECT_CHANGED'
  | 'CANCELLED'
  | 'EXECUTION_FAILED';

export class SkinOperationError extends Error {
  constructor(
    public readonly code: SkinOperationErrorCode,
    message: string,
    options?: { cause?: unknown },
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    if (options && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, configurable: true });
    }
    this.name = 'SkinOperationError';
  }
}

export function toSkinOperationError(error: unknown): SkinOperationError {
  if (error instanceof SkinOperationError) {
    return error;
  }
  if (error instanceof VoxelLimitError) {
    return new SkinOperationError('VOXEL_LIMIT', error.message, { cause: error });
  }
  return new SkinOperationError(
    'EXECUTION_FAILED',
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
