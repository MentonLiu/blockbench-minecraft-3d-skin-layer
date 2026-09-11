import { FACE_DIRECTIONS } from '../domain/constants';
import type {
  FaceDirection,
  FaceSnapshot,
  GeneratorOptions,
  LayerPlan,
  LayerSnapshot,
  PixelSource,
  VoxelSpec,
} from '../domain/types';
import { resolveDepth } from './depthStrategy';
import { adjustedBox, faceSpans, resolveDisabledFaces, voxelBounds } from './faceMapper';
import { enumerateVisibleTexels } from '../texture/pixelReader';

interface FaceRecord {
  plan: LayerPlan;
  voxel: VoxelSpec;
  face: FaceDirection;
  axis: number;
  coord: number;
  normal: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const FACE_AXES: Record<FaceDirection, { axis: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2; normal: 1 | -1 }> = {
  north: { axis: 2, u: 0, v: 1, normal: -1 },
  south: { axis: 2, u: 0, v: 1, normal: 1 },
  west: { axis: 0, u: 2, v: 1, normal: -1 },
  east: { axis: 0, u: 2, v: 1, normal: 1 },
  down: { axis: 1, u: 0, v: 2, normal: -1 },
  up: { axis: 1, u: 0, v: 2, normal: 1 },
};

function faceRecord(plan: LayerPlan, voxel: VoxelSpec, face: FaceDirection): FaceRecord {
  const { axis, u, v, normal } = FACE_AXES[face];
  return {
    plan,
    voxel,
    face,
    axis,
    normal,
    coord: normal < 0 ? voxel.from[axis] : voxel.to[axis],
    u0: voxel.from[u],
    u1: voxel.to[u],
    v0: voxel.from[v],
    v1: voxel.to[v],
  };
}

/**
 * Deterministically disables overlapping coplanar faces that share a plane and
 * normal, keeping the top-left-most face. Source cubes can interpenetrate (the
 * reference legs overlap by 0.2), which otherwise leaves their shells
 * flickering against each other on the shared plane.
 */
export function dedupeCoplanarFaces(plans: LayerPlan[]): void {
  const buckets = new Map<string, FaceRecord[]>();
  for (const plan of plans) {
    for (const voxel of plan.voxels) {
      for (const face of FACE_DIRECTIONS) {
        if (voxel.disabledFaces.includes(face)) {
          continue;
        }
        const record = faceRecord(plan, voxel, face);
        const key = `${record.axis}:${Math.round(record.coord * 1e4) / 1e4}:${record.normal}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(record);
        } else {
          buckets.set(key, [record]);
        }
      }
    }
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    bucket.sort((a, b) =>
      a.u0 - b.u0 || a.v0 - b.v0 ||
      (a.plan.sourceName + a.voxel.name).localeCompare(b.plan.sourceName + b.voxel.name),
    );
    const accepted: FaceRecord[] = [];
    for (const record of bucket) {
      const overlaps = accepted.some(
        kept =>
          Math.min(kept.u1, record.u1) - Math.max(kept.u0, record.u0) > 1e-6 &&
          Math.min(kept.v1, record.v1) - Math.max(kept.v0, record.v0) > 1e-6,
      );
      if (overlaps) {
        record.voxel.disabledFaces.push(record.face);
      } else {
        accepted.push(record);
      }
    }
  }
}

export interface PlannerResult {
  plans: LayerPlan[];
  warnings: string[];
}

export function countPlanVoxels(plans: readonly LayerPlan[]): number {
  return plans.reduce((sum, plan) => sum + plan.voxels.length, 0);
}

function snapshotFace(layer: LayerSnapshot, direction: string): FaceSnapshot | undefined {
  return layer.faces.find(face => face.direction === direction);
}

/**
 * Pure planning pass: turns layer snapshots plus decoded textures into voxel
 * specs without touching the model. Every expensive operation (texture reads,
 * alpha scan, geometry) happens here so mutation can be validated up front.
 */
export function buildVoxelPlans(
  layers: readonly LayerSnapshot[],
  textures: ReadonlyMap<string, PixelSource>,
  options: GeneratorOptions,
): PlannerResult {
  const warnings: string[] = [];
  const plans: LayerPlan[] = [];

  for (const layer of layers) {
    if (layer.to[0] <= layer.from[0] || layer.to[1] <= layer.from[1] || layer.to[2] <= layer.from[2]) {
      warnings.push(`${layer.name}: cube has non-positive size, skipped`);
      continue;
    }

    const box = adjustedBox(layer.from, layer.to, layer.inflate, layer.stretch);
    const voxels: VoxelSpec[] = [];

    for (const direction of FACE_DIRECTIONS) {
      const face = snapshotFace(layer, direction);
      if (!face || !face.enabled) {
        continue;
      }
      const texture = face.textureKey !== null ? textures.get(face.textureKey) : undefined;
      if (!texture) {
        warnings.push(`${layer.name}/${direction}: face has no usable texture, face skipped`);
        continue;
      }

      const scan = enumerateVisibleTexels(face, texture, options.alphaThreshold);
      warnings.push(...scan.warnings.map(warning => `${layer.name}/${warning}`));
      if (scan.cells.length === 0) {
        continue;
      }

      const spans = faceSpans(direction, box);
      const grid = { cols: scan.cells[0].cols, rows: scan.cells[0].rows };
      const texel = { u: spans.uSpan / grid.cols, v: spans.vSpan / grid.rows };
      const depth = resolveDepth(options.depthMode, layer.inflate, texel, options);
      const depthMatchesShell = Math.abs(depth - layer.inflate) <= 1e-4;

      for (const cell of scan.cells) {
        const bounds = voxelBounds(
          direction,
          box,
          cell.col / cell.cols,
          (cell.col + 1) / cell.cols,
          cell.row / cell.rows,
          (cell.row + 1) / cell.rows,
          depth,
        );
        voxels.push({
          name: `px_${direction}_${cell.col}_${cell.row}`,
          from: bounds.from,
          to: bounds.to,
          origin: [...layer.origin],
          rotation: [...layer.rotation],
          textureKey: face.textureKey as string,
          pixelUV: cell.pixelUV,
          face: direction,
          disabledFaces: resolveDisabledFaces(direction, depthMatchesShell),
        });
      }
    }

    const isEmpty = voxels.length === 0;
    if (isEmpty && !options.replaceEmptyLayer) {
      continue;
    }

    plans.push({
      sourceKey: layer.key,
      sourceName: layer.name,
      origin: [...layer.origin],
      voxels,
      visiblePixelCount: voxels.length,
      visibility: layer.visibility,
    });
  }

  dedupeCoplanarFaces(plans);

  return { plans, warnings };
}
