/**
 * 项目复制：把当前项目完整复制为一个新项目标签页，并让副本成为活动项目。
 * 采用 Blockbench 官方 `duplicate_project` 动作相同的配方：
 * `Codecs.project.compile` → `setupProject` → `Codecs.project.parse`。
 * parse 使用空路径调用，副本不会继承原项目的 save_path，
 * 因此在副本上按 Ctrl+S 会走"另存为"，绝不会覆盖原文件。
 *
 * Project duplication: copies the open project into a new project tab and
 * makes the copy active, using the same recipe as Blockbench's built-in
 * `duplicate_project` action: `Codecs.project.compile` → `setupProject` →
 * `Codecs.project.parse`. Parsing with an empty path means the copy does NOT
 * inherit the original's save_path, so saving the copy always goes through
 * "Save As" and can never overwrite the original file.
 */

export interface DuplicateHost {
  /** 当前项目名（重命名副本的基底）/ Name of the open project (rename base). */
  activeProjectName(): string;
  /** 把当前项目编译为可移植快照（强制内嵌纹理数据）/ Compiles the project into a portable snapshot with embedded bitmaps. */
  compileSnapshot(): unknown;
  /** 为副本新建并选中一个项目 / Creates and selects a fresh project for the copy. */
  setupCopyProject(): void;
  /** 把快照载入新项目 / Loads the snapshot into the fresh project. */
  loadSnapshot(model: unknown): void;
  /** 重命名活动项目（即副本）/ Renames the active (copy) project. */
  setProjectName(name: string): void;
}

/** 面向 Blockbench 全局 API 的生产环境复制宿主 / Production duplication host over Blockbench globals. */
export const blockbenchDuplicateHost: DuplicateHost = {
  activeProjectName() {
    return Project.name;
  },
  compileSnapshot() {
    // bitmaps: true 强制内嵌纹理数据，不受用户 embed_textures 设置影响
    // bitmaps: true embeds texture data regardless of the embed_textures setting
    return Codecs.project.compile({ raw: true, bitmaps: true });
  },
  setupCopyProject() {
    setupProject(Project.format);
  },
  loadSnapshot(model) {
    const parse = Codecs.project.parse;
    if (typeof parse !== 'function') {
      throw new Error('Blockbench project codec cannot parse models');
    }
    parse.call(Codecs.project, model, '');
  },
  setProjectName(name) {
    Project.name = name;
  },
};

let autoScanSuppressed = false;

/**
 * 复制过程是否正在抑制插件的 load_project 自动扫描。
 * `Codecs.project.parse` 会触发 Blockbench 的 `load_project` 事件；不抑制的
 * 话，复制副本会误触发本插件的自动生成。
 * Whether the plugin's load_project auto-scan is currently suppressed.
 * `Codecs.project.parse` dispatches Blockbench's `load_project` event; without
 * the suppression, duplicating a project would re-trigger auto generation.
 */
export function isAutoScanSuppressed(): boolean {
  return autoScanSuppressed;
}

/**
 * 在 fn 执行期间抑制 load_project 自动扫描（同步执行，事件同步派发）。
 * Suppresses the load_project auto-scan while `fn` runs (synchronous fn -
 * Blockbench dispatches events synchronously).
 */
export function suppressAutoScanDuring<T>(fn: () => T): T {
  autoScanSuppressed = true;
  try {
    return fn();
  } finally {
    autoScanSuppressed = false;
  }
}

/**
 * 复制当前项目并把副本设为活动项目。`suffix` 追加到副本名上
 * （原项目名可为空，此时保持默认名）。任何错误都会向上抛出，
 * 原项目在整个过程中只被读取、不被修改。
 * Duplicates the open project and activates the copy. `suffix` is appended to
 * the copy's name (empty original names are left alone). Errors propagate;
 * the original project is only ever read, never modified.
 */
export function duplicateCurrentProjectAsCopy(
  host: DuplicateHost = blockbenchDuplicateHost,
  suffix = ' - Copy',
): void {
  const originalName = host.activeProjectName();
  const model = host.compileSnapshot();
  suppressAutoScanDuring(() => {
    host.setupCopyProject();
    host.loadSnapshot(model);
  });
  if (originalName) {
    host.setProjectName(originalName + suffix);
  }
}
