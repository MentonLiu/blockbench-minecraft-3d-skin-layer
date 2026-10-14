import type { WriterHost } from '../blockbench/modelWriter';
import type { ProjectOperationContext } from './projectContext';

/** Guards every runtime read/write and every resumed batch against target-project drift. */
export function bindWriterHost(host: WriterHost, context: ProjectOperationContext): WriterHost {
  type HostMethod = Exclude<keyof WriterHost, 'rollback'>;
  const call = <K extends HostMethod>(key: K) => (...args: Parameters<WriterHost[K]>) => {
    context.assertActive();
    return (host[key] as (...values: Parameters<WriterHost[K]>) => ReturnType<WriterHost[K]>)(...args);
  };

  return {
    beginUndo: call('beginUndo'),
    finishUndo: call('finishUndo'),
    // Rollback deliberately targets the UndoSystem captured when the lease was bound,
    // even if the user switched tabs while the operation yielded to the UI.
    cancelUndo: host.cancelUndo.bind(host),
    rollback(created, groups, revertChanges) {
      if (host.rollback) {
        host.rollback(created, groups, revertChanges);
      } else {
        host.cancelUndo(revertChanges);
      }
    },
    createGroup: call('createGroup'),
    createCube: call('createCube'),
    createCubeFromSnapshot: call('createCubeFromSnapshot'),
    initElement: call('initElement'),
    adopt: call('adopt'),
    placeBefore: call('placeBefore'),
    parentOf: call('parentOf'),
    remove: call('remove'),
    setVisibility: call('setVisibility'),
    updateView: call('updateView'),
    resolveTexture: call('resolveTexture'),
    async yieldToUI() {
      context.assertActive();
      await host.yieldToUI();
      context.assertActive();
    },
  };
}
