import { describe, expect, it } from 'vitest';
import {
  duplicateCurrentProjectAsCopy,
  isAutoScanSuppressed,
} from '../../src/blockbench/projectDuplicate';
import type { DuplicateHost } from '../../src/blockbench/projectDuplicate';

interface RecordedCall {
  op: 'compile' | 'setup' | 'load' | 'rename';
  value?: unknown;
}

function makeRecordingHost(options: {
  name?: string;
  failOnLoad?: boolean;
}): { host: DuplicateHost; calls: RecordedCall[]; suppressedDuringLoad: boolean[] } {
  const calls: RecordedCall[] = [];
  const suppressedDuringLoad: boolean[] = [];
  const host: DuplicateHost = {
    activeProjectName() {
      return options.name ?? '';
    },
    compileSnapshot() {
      calls.push({ op: 'compile', value: options.name });
      return { snapshot: true };
    },
    setupCopyProject() {
      calls.push({ op: 'setup' });
    },
    loadSnapshot(model) {
      // 记录 load 过程中抑制标志的状态：此时 parse 会触发 load_project
      // record the suppression flag during load: parse fires load_project here
      suppressedDuringLoad.push(isAutoScanSuppressed());
      calls.push({ op: 'load', value: model });
      if (options.failOnLoad) {
        throw new Error('parse boom');
      }
    },
    setProjectName(name) {
      calls.push({ op: 'rename', value: name });
    },
  };
  return { host, calls, suppressedDuringLoad };
}

describe('duplicateCurrentProjectAsCopy', () => {
  it('compiles, sets up, loads and renames in the official recipe order', () => {
    const { host, calls } = makeRecordingHost({ name: 'steve' });
    duplicateCurrentProjectAsCopy(host, ' - 3D Layers');
    expect(calls.map(call => call.op)).toEqual(['compile', 'setup', 'load', 'rename']);
    // 重命名发生在 load 之后（parse 会把原始名称合并进副本）
    // the rename happens after load (parse merges the original name into the copy)
    expect(calls[3].value).toBe('steve - 3D Layers');
  });

  it('suppresses the load_project auto-scan only while parsing', () => {
    const { host, calls, suppressedDuringLoad } = makeRecordingHost({ name: 'steve' });
    expect(isAutoScanSuppressed()).toBe(false);
    duplicateCurrentProjectAsCopy(host, ' - Copy');
    expect(suppressedDuringLoad).toEqual([true]);
    expect(isAutoScanSuppressed()).toBe(false);
    expect(calls.map(call => call.op)).toEqual(['compile', 'setup', 'load', 'rename']);
  });

  it('leaves the name untouched when the original project is unnamed', () => {
    const { host, calls } = makeRecordingHost({ name: '' });
    duplicateCurrentProjectAsCopy(host, ' - Copy');
    expect(calls.map(call => call.op)).toEqual(['compile', 'setup', 'load']);
  });

  it('clears the suppression flag and rethrows when parsing fails', () => {
    const { host, calls } = makeRecordingHost({ name: 'steve', failOnLoad: true });
    expect(() => duplicateCurrentProjectAsCopy(host, ' - Copy')).toThrow('parse boom');
    expect(isAutoScanSuppressed()).toBe(false);
    // 加载失败时不重命名：副本保持原状，由调用方决定回滚
    // no rename after a failed load: the copy stays as-is, rollback is up to the caller
    expect(calls.map(call => call.op)).toEqual(['compile', 'setup', 'load']);
  });
});
