import { findLayerCubes } from '../../src/scan/layerScanner';
import type { VoxelSpec } from '../../src/domain/types';
import type { WriterHost } from '../../src/blockbench/modelWriter';
import type { GroupSpec } from '../../src/blockbench/modelWriter';

export interface MockNode {
  kind: 'group' | 'cube';
  uuid: string;
  name: string;
  origin: [number, number, number];
  rotation: [number, number, number];
  visibility: boolean;
  parent: MockNode | null;
  children: MockNode[];
  spec?: VoxelSpec;
  hidden?: boolean;
}

type SerializedNode = {
  uuid: string;
  name: string;
  kind: MockNode['kind'];
  visibility: boolean;
  children?: SerializedNode[];
};

/**
 * Outliner/undo semantics good enough to exercise the writer: nodes live in a
 * tree, init registers at the root, adopt reparents, placeBefore reorders, and
 * undo transactions snapshot the whole tree (object identity is preserved via
 * the registry, like Blockbench keeps removed elements restorable).
 */
export class MockRuntime implements WriterHost {
  root: MockNode[] = [];
  registry = new Map<string, MockNode>();
  undoStack: { label: string; before: SerializedNode[]; after: SerializedNode[] }[] = [];
  redoStack: { label: string; before: SerializedNode[]; after: SerializedNode[] }[] = [];

  beginCount = 0;
  finishCount = 0;
  cancelCount = 0;
  yieldCount = 0;
  createdCubes = 0;
  createdGroups = 0;
  removedCount = 0;
  failCubeCreationAfter = Number.POSITIVE_INFINITY;
  viewUpdates: { elements: number; groups: number }[] = [];

  private currentBefore: SerializedNode[] | null = null;

  private serialize(nodes: readonly MockNode[]): SerializedNode[] {
    return nodes.map(node => ({
      uuid: node.uuid,
      name: node.name,
      kind: node.kind,
      visibility: node.visibility,
      children: node.kind === 'group' ? this.serialize(node.children) : undefined,
    }));
  }

  private restore(snap: readonly SerializedNode[], parent: MockNode | null, into: MockNode[]): void {
    into.length = 0;
    for (const entry of snap) {
      const node = this.registry.get(entry.uuid);
      if (!node) {
        throw new Error(`mock registry lost node ${entry.uuid}`);
      }
      node.parent = parent;
      into.push(node);
      if (entry.children) {
        this.restore(entry.children, node, node.children);
      }
    }
  }

  private detach(node: MockNode): void {
    const list = node.parent ? node.parent.children : this.root;
    const index = list.indexOf(node);
    if (index >= 0) {
      list.splice(index, 1);
    }
  }

  createGroup(spec: GroupSpec): MockNode {
    const uuid = `group-${this.createdGroups++}`;
    const node: MockNode = {
      kind: 'group',
      uuid,
      name: spec.name,
      origin: [...spec.origin],
      rotation: [0, 0, 0],
      visibility: spec.visibility,
      parent: null,
      children: [],
    };
    this.registry.set(uuid, node);
    return node;
  }

  createCube(spec: VoxelSpec): MockNode {
    if (this.createdCubes >= this.failCubeCreationAfter) {
      throw new Error('simulated cube creation failure');
    }
    const uuid = `cube-${this.createdCubes++}`;
    const node: MockNode = {
      kind: 'cube',
      uuid,
      name: spec.name,
      origin: [...spec.origin],
      rotation: [...spec.rotation],
      visibility: true,
      parent: null,
      children: [],
      spec,
    };
    this.registry.set(uuid, node);
    return node;
  }

  initElement(element: unknown): void {
    const node = element as MockNode;
    node.parent = null;
    this.root.push(node);
  }

  adopt(element: unknown, parent: unknown | null): void {
    const node = element as MockNode;
    this.detach(node);
    const target = (parent as MockNode | null) ?? null;
    if (target) {
      target.children.push(node);
    } else {
      this.root.push(node);
    }
    node.parent = target;
  }

  placeBefore(element: unknown, target: unknown): void {
    const node = element as MockNode;
    const anchor = target as MockNode;
    const list = anchor.parent ? anchor.parent.children : this.root;
    this.detach(node);
    const index = list.indexOf(anchor);
    list.splice(index, 0, node);
    node.parent = anchor.parent;
  }

  parentOf(element: unknown): unknown | null {
    return (element as MockNode).parent;
  }

  remove(element: unknown): void {
    const node = element as MockNode;
    this.detach(node);
    node.parent = null;
    this.removedCount++;
  }

  setVisibility(element: unknown, visible: boolean): void {
    (element as MockNode).visibility = visible;
  }

  updateView(created: readonly unknown[], groups: readonly unknown[]): void {
    this.viewUpdates.push({ elements: created.length, groups: groups.length });
  }

  resolveTexture(key: string): unknown {
    return key;
  }

  async yieldToUI(): Promise<void> {
    this.yieldCount++;
    await Promise.resolve();
  }

  beginUndo(): void {
    this.beginCount++;
    this.currentBefore = this.serialize(this.root);
  }

  finishUndo(label: string): void {
    this.finishCount++;
    if (!this.currentBefore) {
      throw new Error('finishUndo without beginUndo');
    }
    this.undoStack.push({
      label,
      before: this.currentBefore,
      after: this.serialize(this.root),
    });
    this.redoStack.length = 0;
    this.currentBefore = null;
  }

  cancelUndo(revertChanges: boolean): void {
    this.cancelCount++;
    if (revertChanges && this.currentBefore) {
      this.restore(this.currentBefore, null, this.root);
    }
    this.currentBefore = null;
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) {
      return;
    }
    this.restore(entry.before, null, this.root);
    this.redoStack.push(entry);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) {
      return;
    }
    this.restore(entry.after, null, this.root);
    this.undoStack.push(entry);
  }

  snapshot(): SerializedNode[] {
    return this.serialize(this.root);
  }

  cubes(): MockNode[] {
    const out: MockNode[] = [];
    const walk = (nodes: MockNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'cube') {
          out.push(node);
        } else {
          walk(node.children);
        }
      }
    };
    walk(this.root);
    return out;
  }

  find(name: string): MockNode | undefined {
    const walk = (nodes: MockNode[]): MockNode | undefined => {
      for (const node of nodes) {
        if (node.name === name) {
          return node;
        }
        if (node.kind === 'group') {
          const found = walk(node.children);
          if (found) {
            return found;
          }
        }
      }
      return undefined;
    };
    return walk(this.root);
  }

  /** Layer scan against the mock tree, mirroring the plugin's Cube.all scan. */
  scanLayerCubes(): MockNode[] {
    return findLayerCubes(this.cubes().map(node => ({ node, name: node.name }))).map(
      entry => entry.node,
    );
  }
}

export interface MockSourceSpec {
  uuid: string;
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  inflate?: number;
  visibility?: boolean;
}

export function addSourceCube(runtime: MockRuntime, spec: MockSourceSpec): void {
  const node: MockNode = {
    kind: 'cube',
    uuid: spec.uuid,
    name: spec.name,
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    visibility: spec.visibility ?? true,
    parent: null,
    children: [],
    spec: {
      name: spec.name,
      from: spec.from,
      to: spec.to,
      origin: [0, 0, 0],
      rotation: [0, 0, 0],
      textureKey: 'tex',
      pixelUV: [0, 0, 1, 1],
      face: 'north',
    },
  };
  runtime.registry.set(node.uuid, node);
  runtime.root.push(node);
}
