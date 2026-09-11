import { MIN_DEPTH } from '../domain/constants';
import type { DepthMode, GeneratorOptions } from '../domain/types';

export interface TexelSize {
  /** Edge length of one texel along the face's model U axis. */
  u: number;
  /** Edge length of one texel along the face's model V axis. */
  v: number;
}

/**
 * Voxel thickness along the face normal, anchored at the raw box surface and
 * extending outward (see faceMapper.voxelBounds).
 *
 * - preserve_layer: the layer's own inflate, so the voxel outer surface lands
 *   exactly on the original layer surface. Falls back to the face texel size
 *   when the layer cube has no inflate (a zero gap cannot hold voxels).
 * - pixel: mean in-face texel edge length, for a true 1x1x1 voxel look.
 * - fixed: user-provided thickness.
 */
export function resolveDepth(
  mode: DepthMode,
  inflate: number,
  texel: TexelSize,
  options: GeneratorOptions,
): number {
  let depth: number;
  switch (mode) {
    case 'preserve_layer':
      depth = inflate > 0 ? inflate : (texel.u + texel.v) / 2;
      break;
    case 'pixel':
      depth = (texel.u + texel.v) / 2;
      break;
    case 'fixed':
      depth = options.fixedDepth;
      break;
  }
  return Math.max(depth, MIN_DEPTH);
}
