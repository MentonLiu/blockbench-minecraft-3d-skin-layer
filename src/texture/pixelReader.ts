import { TEXEL_EPSILON } from '../domain/constants';
import type { FaceSnapshot, PixelSource, TexelCell, UVRect } from '../domain/types';

export interface GridSize {
  /** 沿面模型 U 轴的单元格数 / Cells along the face's model U axis. */
  cols: number;
  /** 沿面模型 V 轴的单元格数 / Cells along the face's model V axis. */
  rows: number;
  /** UV 矩形横向覆盖的图像像素数 / Image texels the UV rect spans horizontally. */
  texelsU: number;
  /** UV 矩形纵向覆盖的图像像素数 / Image texels the UV rect spans vertically. */
  texelsV: number;
}

export interface FaceScan {
  cells: TexelCell[];
  warnings: string[];
}

/** 纹理图像尺寸与 UV 空间尺寸的换算比例 / Image-to-UV scales of a texture. */
export function textureScales(texture: PixelSource): { sx: number; sy: number } {
  const uvWidth = texture.uvWidth > 0 ? texture.uvWidth : texture.width;
  const uvHeight = texture.uvHeight > 0 ? texture.uvHeight : texture.height;
  return { sx: texture.width / uvWidth, sy: texture.height / uvHeight };
}

/** 读取指定像素的 alpha 字节 / Alpha byte of the requested pixel. */
export function getAlpha(texture: PixelSource, x: number, y: number): number {
  const index = (y * texture.width + x) * 4;
  return texture.rgba[index + 3];
}

/**
 * 面在其模型轴上需要的网格单元数。
 * Number of grid cells the face needs along its model axes.
 *
 * 图像像素数由 UV 矩形与纹理比例推导；面旋转 90/270 时，纹理 U 轴对应面的
 * 模型 V 轴，因此数量互换。UV 矩形没有横跨整数像素时返回 null——该面会被
 * 上报而不是被静默取整。
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
 * 一个网格单元对应的图像像素与精确 UV 矩形。
 * Image pixel and exact UV rect of one grid cell.
 *
 * 采样点为单元格中心；UV 方向被保留（反向矩形按镜像采样，与 Blockbench
 * 渲染一致）。面旋转把模型位置旋转进 UV 空间——即对 `CubeFace.UVToLocal`
 * 所做的变换（每 90 度执行一次 `[lerp_x, lerp_y] = [1-lerp_y, lerp_x]`）
 * 求逆。
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
 * 枚举一个面上所有可见像素：alpha 高于阈值的每个网格单元格各生成一个
 * 体素候选。includeTransparent 时跳过 alpha 检查（新建 3D 皮肤流程先
 * 全量体素化，透明像素稍后用"清除透明方块"清理）。单元格之间永不合并；
 * 同一图像像素也可以出现在多个面上。
 * Enumerates the texels of one face: every grid cell whose sampled pixel's
 * alpha exceeds the threshold. With includeTransparent the alpha check is
 * skipped (the new-skin flow voxelizes everything first; transparent cubes are
 * cleaned up later via "Clear Transparent Cubes"). Each cell is an independent
 * voxel candidate - cells are never merged, and the same image pixel can
 * appear on several faces.
 */
export function enumerateVisibleTexels(
  face: FaceSnapshot,
  texture: PixelSource,
  alphaThreshold: number,
  includeTransparent = false,
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
      if (includeTransparent || alpha > alphaThreshold) {
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
