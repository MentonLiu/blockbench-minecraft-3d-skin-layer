import { TEXEL_EPSILON } from '../domain/constants';
import type { FaceSnapshot, PixelSource, TexelCell, UVRect } from '../domain/types';

export interface GridSize {
  /** Cells along the face's model U axis. */
  cols: number;
  /** Cells along the face's model V axis. */
  rows: number;
  /** Image texels the UV rect spans horizontally. */
  texelsU: number;
  /** Image texels the UV rect spans vertically. */
  texelsV: number;
}

export interface FaceScan {
  cells: TexelCell[];
  warnings: string[];
}

export function textureScales(texture: PixelSource): { sx: number; sy: number } {
  const uvWidth = texture.uvWidth > 0 ? texture.uvWidth : texture.width;
  const uvHeight = texture.uvHeight > 0 ? texture.uvHeight : texture.height;
  return { sx: texture.width / uvWidth, sy: texture.height / uvHeight };
}

export function getAlpha(texture: PixelSource, x: number, y: number): number {
  const index = (y * texture.width + x) * 4;
  return texture.rgba[index + 3];
}

/**
 * Number of grid cells the face needs along its model axes.
 *
 * The image texel counts derive from the UV rect and texture scale; with face
 * rotation 90/270 the texture's U axis lies along the face's model V axis, so
 * the counts swap. Returns null when the UV rect does not span whole texels -
 * that face is reported instead of silently rounded.
 */
export function faceGridSize(
  face: FaceSnapshot,
  texture: PixelSource,
  warnings: string[],
): GridSize | null {
  const { sx, sy } = textureScales(texture);
  const [u1, v1, u2, v2] = face.uv;
  const texelsU = Math.abs(u2 - u1) * sx;
  const texelsV = Math.abs(v2 - v1) * sy;
  const roundedU = Math.round(texelsU);
  const roundedV = Math.round(texelsV);

  const maxU = texture.width / sx;
  const maxV = texture.height / sy;
  if (Math.min(u1, u2) < 0 || Math.min(v1, v2) < 0 || Math.max(u1, u2) > maxU || Math.max(v1, v2) > maxV) {
    warnings.push(
      `${face.direction}: UV rect ${face.uv.join(', ')} exceeds the texture bounds, sampled area clamped`,
    );
  }

  if (roundedU < 1 || roundedV < 1) {
    warnings.push(
      `${face.direction}: UV rect ${face.uv.join(', ')} spans no texels, face skipped`,
    );
    return null;
  }
  if (
    Math.abs(texelsU - roundedU) > TEXEL_EPSILON ||
    Math.abs(texelsV - roundedV) > TEXEL_EPSILON
  ) {
    warnings.push(
      `${face.direction}: UV rect ${face.uv.join(', ')} spans non-integer texel counts (${texelsU} x ${texelsV}), face skipped`,
    );
    return null;
  }

  const swapped = face.rotation === 90 || face.rotation === 270;
  return {
    cols: swapped ? roundedV : roundedU,
    rows: swapped ? roundedU : roundedV,
    texelsU: roundedU,
    texelsV: roundedV,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Image pixel and exact UV rect of one grid cell.
 *
 * The sampling point is the cell center. UV direction is preserved: a reversed
 * rect (`u2 < u1`) samples the region mirrored, exactly like Blockbench renders
 * it. Face rotation rotates the model position into UV space, inverting the
 * transform `CubeFace.UVToLocal` applies (`[lerp_x, lerp_y] = [1-lerp_y, lerp_x]`
 * once per 90 degrees).
 */
export function sampleCell(
  face: FaceSnapshot,
  uv: UVRect,
  texture: PixelSource,
  sx: number,
  sy: number,
  grid: GridSize,
  col: number,
  row: number,
): { imageX: number; imageY: number; pixelUV: UVRect } {
  const mx = (col + 0.5) / grid.cols;
  const my = (row + 0.5) / grid.rows;

  let pu: number;
  let pv: number;
  switch (face.rotation) {
    case 90:
      pu = my;
      pv = 1 - mx;
      break;
    case 180:
      pu = 1 - mx;
      pv = 1 - my;
      break;
    case 270:
      pu = 1 - my;
      pv = mx;
      break;
    default:
      pu = mx;
      pv = my;
  }

  let u = uv[0] + (uv[2] - uv[0]) * pu;
  let v = uv[1] + (uv[3] - uv[1]) * pv;

  const maxU = texture.width / sx;
  const maxV = texture.height / sy;
  if (u < 0 || u > maxU || v < 0 || v > maxV) {
    u = clamp(u, 0, Math.max(maxU - Number.EPSILON, 0));
    v = clamp(v, 0, Math.max(maxV - Number.EPSILON, 0));
  }

  const imageX = clamp(Math.floor(u * sx), 0, texture.width - 1);
  const imageY = clamp(Math.floor(v * sy), 0, texture.height - 1);

  const pixelUV: UVRect = [
    imageX / sx,
    imageY / sy,
    (imageX + 1) / sx,
    (imageY + 1) / sy,
  ];
  return { imageX, imageY, pixelUV };
}

/**
 * Enumerates the visible texels of one face: every grid cell whose sampled
 * pixel's alpha exceeds the threshold. Each cell is an independent voxel
 * candidate - cells are never merged, and the same image pixel can appear on
 * several faces.
 */
export function enumerateVisibleTexels(
  face: FaceSnapshot,
  texture: PixelSource,
  alphaThreshold: number,
): FaceScan {
  const warnings: string[] = [];
  const grid = faceGridSize(face, texture, warnings);
  const cells: TexelCell[] = [];
  if (!grid) {
    return { cells, warnings };
  }
  const { sx, sy } = textureScales(texture);

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const sample = sampleCell(face, face.uv, texture, sx, sy, grid, col, row);
      const alpha = getAlpha(texture, sample.imageX, sample.imageY);
      if (alpha > alphaThreshold) {
        cells.push({
          direction: face.direction,
          col,
          row,
          cols: grid.cols,
          rows: grid.rows,
          imageX: sample.imageX,
          imageY: sample.imageY,
          alpha,
          pixelUV: sample.pixelUV,
        });
      }
    }
  }
  return { cells, warnings };
}
