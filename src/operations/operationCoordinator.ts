import { SkinOperationError } from './errors';

export interface OperationLease {
  readonly operationId: string;
  readonly signal: AbortSignal;
}

export function awaitOperationInput<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** One plugin-wide write lease shared by UI, automatic, and MCP operations. */
export class OperationCoordinator {
  private active?: { operationId: string; controller: AbortController };
  private nextId = 1;

  get busy(): boolean {
    return this.active !== undefined;
  }

  async run<T>(
    operation: string,
    execute: (lease: OperationLease) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    if (this.active) {
      throw new SkinOperationError('BUSY', `Another skin operation is already running (${this.active.operationId}).`);
    }
    const controller = new AbortController();
    if (externalSignal?.aborted) {
      throw new SkinOperationError('CANCELLED', 'The operation was cancelled by its caller.', { cause: externalSignal.reason });
    }
    const operationId = `${operation}-${this.nextId++}`;
    const active = { operationId, controller };
    this.active = active;
    const onExternalAbort = () => {
      controller.abort(new SkinOperationError('CANCELLED', 'The operation was cancelled by its caller.', { cause: externalSignal?.reason }));
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      return await execute({ operationId, signal: controller.signal });
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (this.active === active) {
        this.active = undefined;
      }
    }
  }

  cancelActive(reason = 'Plugin is shutting down'): void {
    this.active?.controller.abort(new SkinOperationError('CANCELLED', reason));
  }
}
