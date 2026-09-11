import { FACE_DIRECTIONS } from '../domain/constants';
import type {
  FaceDirection,
  FaceSnapshot,
  LayerSnapshot,
  PixelSource,
  UVRect,
  Vec3,
} from '../domain/types';
import { findLayerCubes } from '../scan/layerScanner';
import type { GeneratorOptions } from '../domain/types';

function asVec3(value: readonly number[] | undefined, fill: number): Vec3 {
  return [
    typeof value?.[0] === 'number' ? value[0] : fill,
    typeof value?.[1] === 'number' ? value[1] : fill,
    typeof value?.[2] === 'number' ? value[2] : fill,
  ];
}

function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const step = ((Math.round((value ?? 0) / 90) * 90) % 360 + 360) % 360;
  return (step === 90 || step === 180 || step === 270 ? step : 0) as 0 | 90 | 180 | 270;
}

function faceTextureKey(face: CubeFace): string | null {
  const texture: unknown = face.texture;
  if (texture === null || texture === undefined || texture === false) {
    return null;
  }
  if (typeof texture === 'string') {
    return texture;
  }
  if (typeof texture === 'object' && texture !== null && 'uuid' in texture) {
    return String((texture as { uuid: unknown }).uuid);
  }
  return null;
}

/** Captures everything the voxel planner needs from a live cube. */
export function snapshotLayerCube(cube: Cube): LayerSnapshot {
  const faces: FaceSnapshot[] = [];
  for (const direction of FACE_DIRECTIONS) {
    const face = cube.faces[direction];
    if (!face) {
      continue;
    }
    faces.push({
      direction,
      // a face with texture === null does not exist for rendering
      enabled: face.texture !== null,
      textureKey: faceTextureKey(face),
      uv: [face.uv[0], face.uv[1], face.uv[2], face.uv[3]] as UVRect,
      rotation: normalizeRotation(face.rotation),
    });
  }
  return {
    key: cube.uuid,
    name: cube.name,
    from: asVec3(cube.from, 0),
    to: asVec3(cube.to, 0),
    inflate: typeof cube.inflate === 'number' ? cube.inflate : 0,
    stretch: asVec3(cube.stretch, 1),
    origin: asVec3(cube.origin, 0),
    rotation: asVec3(cube.rotation, 0),
    visibility: cube.visibility !== false,
    faces,
  };
}

export function collectLayerSnapshots(options: GeneratorOptions): LayerSnapshot[] {
  const cubes = findLayerCubes(Cube.all);
  const selected = options.processSelectedOnly
    ? cubes.filter(cube => cube.selected === true)
    : cubes;
  return selected.map(snapshotLayerCube);
}

export function resolveTextureByKey(key: string): Texture | undefined {
  return Texture.all.find(texture => texture.uuid === key);
}

/**
 * Decodes a texture into a plain pixel snapshot. The texture canvas is the
 * source of truth for internal textures since 4.9; one getImageData call per
 * texture keeps the hot loops free of canvas access.
 */
export function textureToPixelSource(texture: Texture): PixelSource {
  const canvas = texture.canvas;
  if (!canvas) {
    throw new Error(`Texture "${texture.name}" has no canvas to read pixels from`);
  }
  const width = Math.max(1, Math.round(texture.width || canvas.width));
  const height = Math.max(1, Math.round(texture.height || canvas.height));
  const context = texture.ctx ?? canvas.getContext('2d');
  if (!context) {
    throw new Error(`Texture "${texture.name}" exposes no 2d context`);
  }
  const image = context.getImageData(0, 0, width, height);

  const uvWidth =
    typeof texture.getUVWidth === 'function' ? texture.getUVWidth() : texture.uv_width ?? width;
  const uvHeight =
    typeof texture.getUVHeight === 'function' ? texture.getUVHeight() : texture.uv_height ?? height;

  return {
    width,
    height,
    uvWidth: Math.max(1, uvWidth),
    uvHeight: Math.max(1, uvHeight),
    rgba: image.data,
  };
}

/** Decodes every texture referenced by the snapshots, once per texture. */
export function buildTextureMap(
  snapshots: readonly LayerSnapshot[],
): { textures: Map<string, PixelSource>; warnings: string[] } {
  const warnings: string[] = [];
  const textures = new Map<string, PixelSource>();
  for (const snapshot of snapshots) {
    for (const face of snapshot.faces) {
      if (!face.enabled || face.textureKey === null || textures.has(face.textureKey)) {
        continue;
      }
      const texture = resolveTextureByKey(face.textureKey);
      if (!texture) {
        warnings.push(`${snapshot.name}: face texture ${face.textureKey} is not loaded`);
        continue;
      }
      try {
        textures.set(face.textureKey, textureToPixelSource(texture));
      } catch (error) {
        warnings.push(`${snapshot.name}: failed to read texture pixels (${String(error)})`);
      }
    }
  }
  return { textures, warnings };
}

export function isEditMode(): boolean {
  return typeof Modes === 'object' && Modes.edit === true;
}

export function hasOpenProject(): boolean {
  return typeof Project !== 'undefined' && !!Project;
}

export type ProjectListener = () => void;

/** Registers a Blockbench event listener that can be disposed on unload. */
export function onProjectEvent(event: 'load_project' | 'select_project', listener: ProjectListener): { dispose(): void } {
  const handle = Blockbench.on(event, () => listener());
  return {
    dispose() {
      if (typeof handle?.delete === 'function') {
        handle.delete();
      }
    },
  };
}

export function directionList(): readonly FaceDirection[] {
  return FACE_DIRECTIONS;
}
