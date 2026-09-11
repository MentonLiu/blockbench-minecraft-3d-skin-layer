import { FACE_DIRECTIONS, VOXEL_STANDOFF } from '../domain/constants';
import type {
  FaceSnapshot,
  GeneratorOptions,
  LayerPlan,
  LayerSnapshot,
  PixelSource,
  VoxelSpec,
} from '../domain/types';
import { boxUvOffset, faceSpans, voxelBounds } from './faceMapper';
import { enumerateVisibleTexels, textureScales } from '../texture/pixelReader';

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
 * specs without touching the model.
 *
 * Every visible texel becomes a full 1x1x1-texel cube (relative to the
 * texture resolution) anchored on the raw box face - all faces enabled, box
 * UV offset chosen so the shell face samples exactly its source pixel. The
 * uniform standoff keeps a voxel's inner face off the base cube's surface,
 * so no part ever z-fights against itself; overlapping source cubes from
 * DIFFERENT parts (e.g. the reference model's legs in the default pose) keep
 * their shared plane on purpose - posing separates them again.
 */
export function buildVoxelPlans(
  layers: readonly LayerSnapshot[],
  textures: ReadonlyMap<string, PixelSource>,
  options: GeneratorOptions,
): PlannerResult {
  const warnings: string[] = [];
  const plans: LayerPlan[] = [];

  layers.forEach(layer => {
    if (layer.to[0] <= layer.from[0] || layer.to[1] <= layer.from[1] || layer.to[2] <= layer.from[2]) {
      warnings.push(`${layer.name}: cube has non-positive size, skipped`);
      return;
    }
    const standoff = VOXEL_STANDOFF;
    const box = { from: [...layer.from] as [number, number, number], to: [...layer.to] as [number, number, number] };
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
      const cellU = spans.uSpan / grid.cols;
      const cellV = spans.vSpan / grid.rows;
      const depth = (cellU + cellV) / 2;
      const { sx, sy } = textureScales(texture);

      for (const cell of scan.cells) {
        const bounds = voxelBounds(
          direction,
          box,
          cell.col / cell.cols,
          (cell.col + 1) / cell.cols,
          cell.row / cell.rows,
          (cell.row + 1) / cell.rows,
          standoff,
          depth,
        );
        const w = Math.abs(bounds.to[0] - bounds.from[0]);
        const d = Math.abs(bounds.to[2] - bounds.from[2]);
        voxels.push({
          name: `px_${direction}_${cell.col}_${cell.row}`,
          from: bounds.from,
          to: bounds.to,
          origin: [...layer.origin],
          rotation: [...layer.rotation],
          textureKey: face.textureKey as string,
          uvOffset: boxUvOffset(direction, cell.imageX / sx, cell.imageY / sy, w, d),
          face: direction,
        });
      }
    }

    const isEmpty = voxels.length === 0;
    if (isEmpty && !options.replaceEmptyLayer) {
      return;
    }

    plans.push({
      sourceKey: layer.key,
      sourceName: layer.name,
      origin: [...layer.origin],
      voxels,
      visiblePixelCount: voxels.length,
      visibility: layer.visibility,
    });
  });

  return { plans, warnings };
}
