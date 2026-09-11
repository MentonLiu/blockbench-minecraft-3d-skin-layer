import { FACE_DIRECTIONS } from '../domain/constants';
import type { UVRect, VoxelSpec } from '../domain/types';
import { resolveTextureByKey } from './compatibility';
import type { GroupSpec, WriterHost } from './modelWriter';
import { blockbenchUndo } from './undoTransaction';

function voxelFaces(spec: VoxelSpec) {
  const uv: UVRect = [spec.pixelUV[0], spec.pixelUV[1], spec.pixelUV[2], spec.pixelUV[3]];
  const texture = resolveTextureByKey(spec.textureKey);
  const make = () => ({
    texture: texture ? texture.uuid : (false as const),
    uv: [uv[0], uv[1], uv[2], uv[3]] as [number, number, number, number],
    rotation: 0,
  });
  const faces: Record<string, ReturnType<typeof make>> = {};
  for (const direction of FACE_DIRECTIONS) {
    faces[direction] = make();
  }
  return faces;
}

/** Production writer host speaking to Blockbench's global model APIs. */
export const blockbenchHost: WriterHost = {
  beginUndo(aspects) {
    blockbenchUndo.begin(aspects);
  },
  finishUndo(label, aspects) {
    blockbenchUndo.finish(label, aspects);
  },
  cancelUndo(revertChanges) {
    blockbenchUndo.cancel(revertChanges);
  },

  createGroup(spec: GroupSpec) {
    const group = new Group({
      name: spec.name,
      origin: [...spec.origin],
      visibility: spec.visibility,
    });
    return group;
  },

  createCube(spec: VoxelSpec) {
    const cube = new Cube({
      name: spec.name,
      from: [...spec.from],
      to: [...spec.to],
      origin: [...spec.origin],
      rotation: [...spec.rotation],
      box_uv: false,
      autouv: 0,
      faces: voxelFaces(spec),
    });
    return cube;
  },

  initElement(element) {
    (element as { init(): unknown }).init();
  },

  adopt(element, parent) {
    (element as { addTo(group?: Group): unknown }).addTo(
      (parent as Group | null) ?? undefined,
    );
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
