import { describe, expect, it } from 'vitest';
import { SkinOperationError } from '../../src/operations/errors';
import { awaitOperationInput, OperationCoordinator } from '../../src/operations/operationCoordinator';

describe('OperationCoordinator', () => {
  it('holds the single write lease until the full asynchronous operation settles', async () => {
    const coordinator = new OperationCoordinator();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = coordinator.run('regenerate', async () => {
      await gate;
      return 'done';
    });

    await expect(coordinator.run('clear_transparent', async () => 'unexpected'))
      .rejects.toMatchObject({ code: 'BUSY' });
    expect(coordinator.busy).toBe(true);
    release();
    await expect(first).resolves.toBe('done');
    expect(coordinator.busy).toBe(false);
  });

  it('aborts a pending UI wait and releases the lease on plugin shutdown', async () => {
    const coordinator = new OperationCoordinator();
    const result = coordinator.run('generate', ({ signal }) =>
      awaitOperationInput(new Promise<string>(() => undefined), signal),
    );
    coordinator.cancelActive('Plugin disabled');
    await expect(result).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'Plugin disabled',
    } satisfies Partial<SkinOperationError>);
    expect(coordinator.busy).toBe(false);
  });

  it('propagates the MCP request signal into the shared lease', async () => {
    const coordinator = new OperationCoordinator();
    const external = new AbortController();
    const result = coordinator.run(
      'generate',
      ({ signal }) => awaitOperationInput(new Promise<string>(() => undefined), signal),
      external.signal,
    );
    external.abort('client disconnected');
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(coordinator.busy).toBe(false);
  });

  it('releases the lease and preserves asynchronous failures', async () => {
    const coordinator = new OperationCoordinator();
    const failure = new Error('async writer failed');
    await expect(coordinator.run('regenerate', async () => {
      await Promise.resolve();
      throw failure;
    })).rejects.toBe(failure);
    expect(coordinator.busy).toBe(false);
    await expect(coordinator.run('clear_transparent', async () => 'ready')).resolves.toBe('ready');
  });
});
