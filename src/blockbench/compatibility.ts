import {
  FACE_DIRECTIONS,
  FACE_EPSILON_STEP,
  GENERATED_SOURCE_PROPERTY,
  LAYER_NAME_RE,
  VOXEL_STANDOFF,
} from '../domain/constants';
import type {
  GeneratedLayerMetadata,
  FaceSnapshot,
  FaceDirection,
  LayerSnapshot,
  PixelSource,
  UVRect,
  Vec3,
} from '../domain/types';
import { findLayerCubes } from '../scan/layerScanner';
import type { GeneratorOptions } from '../domain/types';
import type { RestoreCandidate } from './modelRestorer';

/** 把运行时数组补齐为三元 Vec3，缺失位以 fill 填充 / Pad an array into a Vec3. */
function asVec3(value: readonly number[] | undefined, fill: number): Vec3 {
  return [
    typeof value?.[0] === 'number' ? value[0] : fill,
    typeof value?.[1] === 'number' ? value[1] : fill,
    typeof value?.[2] === 'number' ? value[2] : fill,
  ];
}

/** 把旋转值归一化到 0/90/180/270 / Normalize a rotation to 0/90/180/270. */
function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const step = ((Math.round((value ?? 0) / 90) * 90) % 360 + 360) % 360;
  return (step === 90 || step === 180 || step === 270 ? step : 0) as 0 | 90 | 180 | 270;
}

/**
 * 提取面的纹理键：null 表示该面被禁用或没有纹理。
 * Blockbench 中 texture === null 表示该面不存在（不渲染）。
 * Extract the texture key of a face: null means disabled or untextured.
 * In Blockbench, texture === null means the face does not exist (not rendered).
 */
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

/** 从活动立方体捕获体素规划器需要的全部数据 / Captures everything the planner needs from a live cube. */
export function snapshotLayerCube(cube: Cube): LayerSnapshot {
  const faces: FaceSnapshot[] = [];
  for (const direction of FACE_DIRECTIONS) {
    const face = cube.faces[direction];
    if (!face) {
      continue;
    }
    faces.push({
      direction,
      // texture === null 的面不参与渲染 / a face with texture === null does not exist for rendering
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
    boxUV: cube.box_uv,
    autouv: cube.autouv,
    mirrorUV: cube.mirror_uv,
    shade: cube.shade,
    color: typeof cube.color === 'number' ? cube.color : undefined,
    rescale: cube.rescale,
    rotationAxis: cube.rotation_axis,
    uvOffset: Array.isArray(cube.uv_offset)
      ? [cube.uv_offset[0], cube.uv_offset[1]]
      : undefined,
    faces,
  };
}

const VOXEL_NAME_RE = /^px_(north|east|south|west|up|down)_(\d+)_(\d+)$/i;

interface CubeNodeLike {
  name: string;
  uuid: string;
  from: readonly number[];
  to: readonly number[];
  rotation?: readonly number[];
  faces: Record<string, CubeFace>;
  [key: string]: unknown;
}

interface GroupNodeLike {
  name: string;
  uuid: string;
  children: unknown[];
  parent?: unknown;
  origin?: readonly number[];
  visibility?: boolean;
  [key: string]: unknown;
}

interface VoxelChild {
  cube: CubeNodeLike;
  direction: FaceDirection;
  col: number;
  row: number;
}

function isCubeNode(value: unknown): value is CubeNodeLike {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const node = value as Partial<CubeNodeLike>;
  return (
    typeof node.name === 'string' &&
    typeof node.uuid === 'string' &&
    Array.isArray(node.from) &&
    Array.isArray(node.to) &&
    typeof node.faces === 'object' &&
    node.faces !== null
  );
}

function isGroupNode(value: unknown): value is GroupNodeLike {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as GroupNodeLike).children));
}

function parseVoxelChild(value: unknown): VoxelChild | undefined {
  if (!isCubeNode(value)) {
    return undefined;
  }
  const match = VOXEL_NAME_RE.exec(value.name);
  if (!match) {
    return undefined;
  }
  return {
    cube: value,
    direction: match[1].toLowerCase() as FaceDirection,
    col: Number(match[2]),
    row: Number(match[3]),
  };
}

function readVec3(value: readonly number[] | undefined, fallback: Vec3): Vec3 {
  return [
    typeof value?.[0] === 'number' ? value[0] : fallback[0],
    typeof value?.[1] === 'number' ? value[1] : fallback[1],
    typeof value?.[2] === 'number' ? value[2] : fallback[2],
  ];
}

function isLayerSnapshot(value: unknown): value is LayerSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const source = value as Partial<LayerSnapshot>;
  return (
    typeof source.key === 'string' &&
    typeof source.name === 'string' &&
    Array.isArray(source.from) &&
    Array.isArray(source.to) &&
    Array.isArray(source.faces)
  );
}

function metadataSource(group: GroupNodeLike): LayerSnapshot | undefined {
  const metadata = group[GENERATED_SOURCE_PROPERTY] as GeneratedLayerMetadata | undefined;
  return metadata?.schema === 1 && isLayerSnapshot(metadata.source) ? metadata.source : undefined;
}

function parentChildren(group: GroupNodeLike): readonly unknown[] {
  const parent = group.parent;
  if (isGroupNode(parent)) {
    return parent.children;
  }
  return typeof Outliner === 'object' && Array.isArray(Outliner.root) ? Outliner.root : [];
}

function findSiblingCube(group: GroupNodeLike, names: readonly string[], hiddenOnly: boolean): CubeNodeLike | undefined {
  return parentChildren(group).find((node): node is CubeNodeLike => {
    if (!isCubeNode(node) || !names.includes(node.name)) {
      return false;
    }
    return !hiddenOnly || node.visibility === false;
  });
}

function baseNamesForLayer(name: string): string[] {
  const match = /^(.*)\sLayer(\d*)$/i.exec(name);
  if (!match) {
    return [];
  }
  const base = match[1];
  const suffix = match[2];
  return suffix ? [`${base}${suffix}`, base] : [base];
}

function faceGridDimensions(direction: FaceDirection, from: Vec3, to: Vec3): [number, number] {
  const size = [Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), Math.abs(to[2] - from[2])];
  switch (direction) {
    case 'north':
    case 'south':
      return [Math.max(1, Math.round(size[0])), Math.max(1, Math.round(size[1]))];
    case 'east':
    case 'west':
      return [Math.max(1, Math.round(size[2])), Math.max(1, Math.round(size[1]))];
    case 'up':
    case 'down':
      return [Math.max(1, Math.round(size[0])), Math.max(1, Math.round(size[2]))];
  }
}

function inferFace(
  direction: FaceDirection,
  entries: readonly VoxelChild[],
  sourceFrom: Vec3,
  sourceTo: Vec3,
): FaceSnapshot | undefined {
  const samples = entries
    .map(entry => {
      const face = entry.cube.faces[direction];
      if (!face || face.texture === null || face.texture === false || !Array.isArray(face.uv)) {
        return undefined;
      }
      return {
        col: entry.col,
        row: entry.row,
        centerU: (face.uv[0] + face.uv[2]) / 2,
        centerV: (face.uv[1] + face.uv[3]) / 2,
        pixelU: Math.abs(face.uv[2] - face.uv[0]),
        pixelV: Math.abs(face.uv[3] - face.uv[1]),
        textureKey: faceTextureKey(face),
      };
    })
    .filter((sample): sample is NonNullable<typeof sample> => sample !== undefined);
  if (samples.length === 0 || samples[0].textureKey === null) {
    return undefined;
  }

  const [cols, rows] = faceGridDimensions(direction, sourceFrom, sourceTo);
  const pixelU = samples[0].pixelU || 1;
  const pixelV = samples[0].pixelV || 1;
  const first = samples[0];
  const candidates = [0, 90, 180, 270] as const;
  let best: { rotation: 0 | 90 | 180 | 270; uv: UVRect; error: number } | undefined;

  for (const rotation of candidates) {
    const swapped = rotation === 90 || rotation === 270;
    const spanU = pixelU * (swapped ? rows : cols);
    const spanV = pixelV * (swapped ? cols : rows);
    const parameter = (col: number, row: number): [number, number] => {
      switch (rotation) {
        case 90:
          return [(row + 0.5) / rows, 1 - (col + 0.5) / cols];
        case 180:
          return [1 - (col + 0.5) / cols, 1 - (row + 0.5) / rows];
        case 270:
          return [1 - (row + 0.5) / rows, (col + 0.5) / cols];
        default:
          return [(col + 0.5) / cols, (row + 0.5) / rows];
      }
    };
    const [firstU, firstV] = parameter(first.col, first.row);
    const sourceU0 = first.centerU - firstU * spanU;
    const sourceV0 = first.centerV - firstV * spanV;
    const uv: UVRect = [sourceU0, sourceV0, sourceU0 + spanU, sourceV0 + spanV];
    let error = 0;
    for (const sample of samples) {
      const [u, v] = parameter(sample.col, sample.row);
      error += Math.abs(sample.centerU - (sourceU0 + u * spanU));
      error += Math.abs(sample.centerV - (sourceV0 + v * spanV));
    }
    if (!best || error < best.error) {
      best = { rotation, uv, error };
    }
  }
  return {
    direction,
    enabled: true,
    textureKey: first.textureKey,
    uv: best!.uv,
    rotation: best!.rotation,
  };
}

function inferLegacySource(group: GroupNodeLike, children: readonly VoxelChild[]): LayerSnapshot | undefined {
  if (children.length === 0) {
    return undefined;
  }
  const baseCube = findSiblingCube(group, baseNamesForLayer(group.name), false);
  const base = baseCube ? snapshotLayerCube(baseCube as unknown as Cube) : undefined;
  const firstRotation = readVec3(children[0].cube.rotation, base?.rotation ?? [0, 0, 0]);
  const inflateSamples = children.map(child => {
    const axis = child.direction === 'north' || child.direction === 'south'
      ? 2
      : child.direction === 'east' || child.direction === 'west'
        ? 0
        : 1;
    const thickness = Math.abs(child.cube.to[axis] - child.cube.from[axis]);
    return Math.max(0, thickness - FACE_DIRECTIONS.indexOf(child.direction) * FACE_EPSILON_STEP);
  });
  const inflate = inflateSamples.reduce((sum, value) => sum + value, 0) / inflateSamples.length;
  const sourceFrom: Vec3 = base?.from ? [...base.from] as Vec3 : [Infinity, Infinity, Infinity];
  const sourceTo: Vec3 = base?.to ? [...base.to] as Vec3 : [-Infinity, -Infinity, -Infinity];
  if (!base) {
    for (const child of children) {
      for (let axis = 0; axis < 3; axis++) {
        sourceFrom[axis] = Math.min(sourceFrom[axis], child.cube.from[axis]);
        sourceTo[axis] = Math.max(sourceTo[axis], child.cube.to[axis]);
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      sourceFrom[axis] += inflate;
      sourceTo[axis] -= inflate;
    }
    for (const child of children) {
      switch (child.direction) {
        case 'north': sourceFrom[2] = Math.min(sourceFrom[2], child.cube.to[2] + VOXEL_STANDOFF); break;
        case 'south': sourceTo[2] = Math.max(sourceTo[2], child.cube.from[2] - VOXEL_STANDOFF); break;
        case 'east': sourceTo[0] = Math.max(sourceTo[0], child.cube.from[0] - VOXEL_STANDOFF); break;
        case 'west': sourceFrom[0] = Math.min(sourceFrom[0], child.cube.to[0] + VOXEL_STANDOFF); break;
        case 'up': sourceTo[1] = Math.max(sourceTo[1], child.cube.from[1] - VOXEL_STANDOFF); break;
        case 'down': sourceFrom[1] = Math.min(sourceFrom[1], child.cube.to[1] + VOXEL_STANDOFF); break;
      }
    }
  }

  const faces = FACE_DIRECTIONS.flatMap(direction => {
    const entries = children.filter(child => child.direction === direction);
    const face = inferFace(direction, entries, sourceFrom, sourceTo);
    return face ? [face] : [];
  });
  if (faces.length === 0) {
    return undefined;
  }
  return {
    key: group.uuid,
    name: group.name,
    from: sourceFrom,
    to: sourceTo,
    inflate,
    stretch: base?.stretch ?? [1, 1, 1],
    origin: base?.origin ?? readVec3(group.origin as readonly number[] | undefined, [0, 0, 0]),
    rotation: base?.rotation ?? firstRotation,
    visibility: group.visibility !== false,
    boxUV: base?.boxUV,
    autouv: base?.autouv,
    mirrorUV: base?.mirrorUV,
    shade: base?.shade,
    color: base?.color,
    rescale: base?.rescale,
    rotationAxis: base?.rotationAxis,
    uvOffset: base?.uvOffset,
    faces,
  };
}

function candidateForGroup(group: GroupNodeLike): RestoreCandidate | undefined {
  const parsedChildren = group.children.map(parseVoxelChild);
  const children = parsedChildren.filter((child): child is VoxelChild => child !== undefined);
  const metadata = metadataSource(group);
  if (!metadata && (children.length === 0 || children.length !== group.children.length)) {
    return undefined;
  }
  const source = metadata ?? inferLegacySource(group, children);
  if (!source) {
    return undefined;
  }
  const existingSource = findSiblingCube(group, [group.name], true);
  return { group, children: children.map(child => child.cube), source, existingSource };
}

/** Whether at least one generated group can be restored. */
export function hasRestorableGroups(): boolean {
  return (
    typeof Group !== 'undefined' &&
    Group.all.some(group => {
      const node = group as unknown as GroupNodeLike;
      return LAYER_NAME_RE.test(node.name) && Boolean(candidateForGroup(node));
    })
  );
}

/** Collects exact 0.3.1 groups and compatible legacy generated groups. */
export function collectRestoreCandidates(): RestoreCandidate[] {
  if (typeof Group === 'undefined') {
    return [];
  }
  return Group.all.flatMap(group => {
    const node = group as unknown as GroupNodeLike;
    if (!LAYER_NAME_RE.test(node.name)) {
      return [];
    }
    const candidate = candidateForGroup(node);
    return candidate ? [candidate] : [];
  });
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
 * 把纹理解码为纯像素快照。4.9 起，内部模式的纹理画布是唯一数据源；
 * 每张纹理只调用一次 getImageData，让热点循环完全摆脱画布访问。
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

/** 把快照引用到的每张纹理各解码一次 / Decodes every referenced texture once. */
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

/** 当前是否处于编辑模式 / Whether Edit mode is active. */
export function isEditMode(): boolean {
  return typeof Modes === 'object' && Modes.edit === true;
}

/** 是否有已打开的项目 / Whether a project is open. */
export function hasOpenProject(): boolean {
  return typeof Project !== 'undefined' && !!Project;
}

export type ProjectListener = () => void;

/** 注册一个可在卸载时销毁的 Blockbench 事件监听 / Register a disposable Blockbench event listener. */
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
