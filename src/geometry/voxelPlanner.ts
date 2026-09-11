import { FACE_DIRECTIONS } from '../domain/constants';
import type {
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
          disabledFaces: resolveDisabledFaces(direction, box, bounds, depthMatchesShell),
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

  return { plans, warnings };
}
