import { FACE_DIRECTIONS } from '../domain/constants';
import { GENERATED_SOURCE_PROPERTY } from '../domain/constants';
import type { GeneratedLayerMetadata, LayerSnapshot, UVRect, VoxelSpec } from '../domain/types';
import { resolveTextureByKey } from './compatibility';
import type { GroupSpec, WriterHost } from './modelWriter';
import { blockbenchUndo, createUndoTransaction } from './undoTransaction';
import type { UndoTransaction } from './undoTransaction';
import { suppressAutoScanDuring } from './projectDuplicate';

function voxelFaces(spec: VoxelSpec) {
  const uv: UVRect = [spec.pixelUV[0], spec.pixelUV[1], spec.pixelUV[2], spec.pixelUV[3]];
  const texture = resolveTextureByKey(spec.textureKey);
  const make = () => ({
    texture: texture ? texture.uuid : (false as const),
    uv: [uv[0], uv[1], uv[2], uv[3]] as [number, number, number, number],
  });
  const faces: Record<string, ReturnType<typeof make>> = {};
  for (const direction of FACE_DIRECTIONS) {
    faces[direction] = make();
  }
  return faces;
}

function snapshotFaces(snapshot: LayerSnapshot) {
  const faces: Record<string, {
    texture: string | false;
    uv: [number, number, number, number];
    rotation: 0 | 90 | 180 | 270;
    enabled: boolean;
  }> = {};
  for (const face of snapshot.faces) {
    const texture = resolveTextureByKey(face.textureKey ?? '');
    faces[face.direction] = {
      texture: texture ? texture.uuid : false,
      uv: [...face.uv],
      rotation: face.rotation,
      enabled: face.enabled,
    };
  }
  return faces;
}

/** Reparents an initialized element after removing its provisional root entry. */
export function adoptInitializedElement(element: unknown, parent: Group | null): void {
  const node = element as {
    removeFromParent(): unknown;
    addTo(group?: Group | 'root'): unknown;
  };
  node.removeFromParent();
  node.addTo(parent ?? 'root');
}

/** 面向 Blockbench 全局模型 API 的生产环境写入宿主 / Production writer host over Blockbench's global model APIs. */
function createBlockbenchHost(undo: UndoTransaction): WriterHost {
  return {
    beginUndo(aspects) {
      undo.begin(aspects);
    },
    finishUndo(label, aspects) {
      undo.finish(label, aspects);
    },
    cancelUndo(revertChanges) {
      undo.cancel(revertChanges);
    },

    createGroup(spec: GroupSpec) {
      const group = new Group({
        name: spec.name,
        origin: [...spec.origin],
        visibility: spec.visibility,
      });
      if (spec.restoreData) {
        (group as Group & { [GENERATED_SOURCE_PROPERTY]?: GeneratedLayerMetadata })[
          GENERATED_SOURCE_PROPERTY
        ] = spec.restoreData;
      }
      return group;
    },

    createCube(spec: VoxelSpec) {
      return new Cube({
        name: spec.name,
        from: [...spec.from],
        to: [...spec.to],
        origin: [...spec.origin],
        rotation: [...spec.rotation],
        box_uv: false,
        autouv: 0,
        faces: voxelFaces(spec),
      });
    },

    createCubeFromSnapshot(snapshot: LayerSnapshot) {
      const cube = new Cube({
        name: snapshot.name,
        from: [...snapshot.from],
        to: [...snapshot.to],
        origin: [...snapshot.origin],
        rotation: [...snapshot.rotation],
        stretch: [...(snapshot.stretch ?? [1, 1, 1])],
        inflate: snapshot.inflate,
        visibility: snapshot.visibility,
        box_uv: snapshot.boxUV ?? false,
        autouv: snapshot.autouv ?? 0,
        mirror_uv: snapshot.mirrorUV ?? false,
        shade: snapshot.shade ?? true,
        color: snapshot.color,
        uv_offset: snapshot.uvOffset ? [...snapshot.uvOffset] : undefined,
        faces: snapshotFaces(snapshot),
      });
      if (snapshot.rescale !== undefined) {
        cube.rescale = snapshot.rescale;
      }
      if (snapshot.rotationAxis) {
        cube.rotation_axis = snapshot.rotationAxis;
      }
      return cube;
    },

    initElement(element) {
      (element as { init(): unknown }).init();
    },

    adopt(element, parent) {
      adoptInitializedElement(element, (parent as Group | null) ?? null);
    },

    placeBefore(element, target) {
      (element as { sortInBefore(target?: unknown, indexModifier?: number): unknown }).sortInBefore(
        target,
        0,
      );
    },

    parentOf(element) {
      return (element as { parent?: unknown }).parent ?? null;
    },

    remove(element) {
      (element as { remove(): void }).remove();
    },

    setVisibility(element, visible) {
      const node = element as { visibility?: boolean };
      node.visibility = visible;
    },

    updateView(created, groups) {
      Canvas.updateView({
        elements: created as Cube[],
        element_aspects: {
          geometry: true,
          faces: true,
          uv: true,
          transform: true,
          visibility: true,
        },
        groups: groups as Group[],
        group_aspects: {
          transform: true,
          visibility: true,
        },
      });
    },

    resolveTexture(key) {
      return resolveTextureByKey(key);
    },

    yieldToUI() {
      return new Promise<void>(resolve => setTimeout(resolve, 0));
    },
  };
}

export const blockbenchHost: WriterHost = createBlockbenchHost(blockbenchUndo);

/** Creates a writer whose undo lifecycle is owned by the captured project. */
export function blockbenchHostForProject(project: Pick<ModelProject, 'undo'>): WriterHost {
  const host = createBlockbenchHost(createUndoTransaction(project.undo));
  const cancelCapturedUndo = host.cancelUndo;
  host.cancelUndo = revertChanges => {
    const activeProject = typeof Project === 'undefined' ? undefined : Project;
    if (activeProject?.uuid === (project as ModelProject).uuid) {
      cancelCapturedUndo(revertChanges);
      return;
    }
    const targetProject = project as ModelProject;
    if (!ModelProject.all.includes(targetProject)) {
      throw new Error('The operation target project was closed before its changes could be rolled back.');
    }
    suppressAutoScanDuring(() => {
      if (!targetProject.select() || Project.uuid !== targetProject.uuid) {
        throw new Error('Blockbench could not restore the operation target project for rollback.');
      }
      try {
        cancelCapturedUndo(revertChanges);
      } finally {
        if (activeProject && ModelProject.all.includes(activeProject)) {
          activeProject.select();
        }
      }
    });
  };
  host.rollback = (created, groups, revertChanges) => {
    const targetProject = project as ModelProject;
    const activeProject = typeof Project === 'undefined' ? undefined : Project;
    const rollbackInTarget = () => {
      let rollbackError: unknown;
      for (const node of [...created].reverse()) {
        try {
          host.remove(node);
        } catch (error) {
          rollbackError ??= error;
        }
      }
      for (const group of [...groups].reverse()) {
        try {
          host.remove(group);
        } catch (error) {
          rollbackError ??= error;
        }
      }
      try {
        cancelCapturedUndo(revertChanges);
      } catch (error) {
        rollbackError ??= error;
      }
      if (rollbackError) {
        const failure = new Error('Blockbench could not fully roll back the skin operation.');
        Object.defineProperty(failure, 'cause', { value: rollbackError, configurable: true });
        throw failure;
      }
    };

    if (activeProject?.uuid === targetProject.uuid) {
      rollbackInTarget();
      return;
    }
    if (!ModelProject.all.includes(targetProject)) {
      throw new Error('The operation target project was closed before its changes could be rolled back.');
    }
    suppressAutoScanDuring(() => {
      try {
        if (!targetProject.select() || Project.uuid !== targetProject.uuid) {
          throw new Error('Blockbench could not restore the operation target project for rollback.');
        }
        rollbackInTarget();
      } finally {
        if (activeProject && ModelProject.all.includes(activeProject)) {
          activeProject.select();
        }
      }
    });
  };
  return host;
}
