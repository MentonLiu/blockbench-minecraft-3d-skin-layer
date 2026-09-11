import { FACE_DIRECTIONS, FACE_EPSILON_STEP, VOXEL_STANDOFF } from '../domain/constants';
import type {
  FaceDirection,
  FaceSnapshot,
  GeneratorOptions,
  LayerPlan,
  LayerSnapshot,
  PixelSource,
  UVRect,
  VoxelSpec,
} from '../domain/types';
import { adjustedBox, voxelBounds } from './faceMapper';
import type { Box } from './faceMapper';
import { enumerateVisibleTexels, textureScales } from '../texture/pixelReader';

export interface PlannerResult {
  plans: LayerPlan[];
  warnings: string[];
}

export function countPlanVoxels(plans: readonly LayerPlan[]): number {
  return plans.reduce((sum, plan) => sum + plan.voxels.length, 0);
}

/** Epsilon of a direction: north 0, east 1 * step, ... down 5 * step. */
export function directionEpsilon(direction: FaceDirection): number {
  return FACE_DIRECTIONS.indexOf(direction) * FACE_EPSILON_STEP;
}

function snapshotFace(layer: LayerSnapshot, direction: string): FaceSnapshot | undefined {
  return layer.faces.find(face => face.direction === direction);
}

/**
 * Pure planning pass: turns layer snapshots plus decoded textures into voxel
 * specs without touching the model.
 *
 * Every visible texel becomes a full voxel with ALL six faces mapping to its
 * source pixel (per-face UV, box_uv off). The voxel fills the layer's own
 * shell: depth = inflate, outer surface within 0.009 of the original layer
 * surface. Faces of different directions can never share a plane because each
 * direction's grid and thickness carry a tiny epsilon (max 0.0075 -
 * imperceptible), and the uniform standoff lifts the inner faces off the base
 * cube. Cross-part overlaps of the source pose are kept untouched.
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
    const inflated = adjustedBox(layer.from, layer.to, layer.inflate, layer.stretch);
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

      const epsilon = directionEpsilon(direction);
      // translate (not inset) the face box: cells stay exactly texel-sized and
      // every grid line shifts by this direction's epsilon, so grid lines of
      // different directions never coincide (a symmetric inset would keep the
      // center line shared)
      const faceBox: Box = {
        from: [inflated.from[0] + epsilon, inflated.from[1] + epsilon, inflated.from[2] + epsilon],
        to: [inflated.to[0] + epsilon, inflated.to[1] + epsilon, inflated.to[2] + epsilon],
      };
      const scan = enumerateVisibleTexels(face, texture, options.alphaThreshold);
      warnings.push(...scan.warnings.map(warning => `${layer.name}/${warning}`));
      if (scan.cells.length === 0) {
        continue;
      }

      const depth = layer.inflate + epsilon;

      for (const cell of scan.cells) {
        const bounds = voxelBounds(
          direction,
          faceBox,
          layer.from,
          layer.to,
          cell.col / cell.cols,
          (cell.col + 1) / cell.cols,
          cell.row / cell.rows,
          (cell.row + 1) / cell.rows,
          VOXEL_STANDOFF,
          depth,
        );
        const pixelUV: UVRect = [
          cell.imageX / textureScales(texture).sx,
          cell.imageY / textureScales(texture).sy,
          (cell.imageX + 1) / textureScales(texture).sx,
          (cell.imageY + 1) / textureScales(texture).sy,
        ];
        voxels.push({
          name: `px_${direction}_${cell.col}_${cell.row}`,
          from: bounds.from,
          to: bounds.to,
          origin: [...layer.origin],
          rotation: [...layer.rotation],
          textureKey: face.textureKey as string,
          pixelUV,
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
