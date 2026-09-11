import { describe, expect, it } from 'vitest';
import type { FaceSnapshot, PixelSource, UVRect } from '../../src/domain/types';
import {
  enumerateVisibleTexels,
  faceGridSize,
  getAlpha,
  sampleCell,
  textureScales,
} from '../../src/texture/pixelReader';

function makeTexture(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
  uvWidth = width,
  uvHeight = height,
): PixelSource {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width, height, uvWidth, uvHeight, rgba };
}

function face(direction: FaceSnapshot['direction'], uv: UVRect, rotation: FaceSnapshot['rotation'] = 0): FaceSnapshot {
  return { direction, enabled: true, textureKey: 'tex', uv, rotation };
}

describe('texture scales', () => {
  it('is 1 for 64px image with 64 UV space', () => {
    expect(textureScales(makeTexture(64, 64, () => [0, 0, 0, 0]))).toEqual({ sx: 1, sy: 1 });
  });

  it('is 2 for a 128px image with 64 UV space', () => {
    expect(textureScales(makeTexture(128, 128, () => [0, 0, 0, 0], 64, 64))).toEqual({ sx: 2, sy: 2 });
  });
});

describe('getAlpha', () => {
  it('reads the alpha byte of the requested pixel', () => {
    const tex = makeTexture(2, 2, (x, y) => [x, y, 0, y === 0 ? 255 : 7]);
    expect(getAlpha(tex, 0, 0)).toBe(255);
    expect(getAlpha(tex, 1, 1)).toBe(7);
  });
});

describe('faceGridSize', () => {
  const tex64 = makeTexture(64, 64, () => [0, 0, 0, 255]);

  it('gives 8x8 for a head front on a 64px skin', () => {
    const warnings: string[] = [];
    expect(faceGridSize(face('north', [40, 8, 48, 16]), tex64, warnings)).toEqual({
      cols: 8,
      rows: 8,
      texelsU: 8,
      texelsV: 8,
    });
    expect(warnings).toEqual([]);
  });

  it('gives 16x16 when the image is 128px but UV space stays 64', () => {
    const tex128 = makeTexture(128, 128, () => [0, 0, 0, 255], 64, 64);
    const warnings: string[] = [];
    expect(faceGridSize(face('north', [8, 8, 16, 16]), tex128, warnings)).toEqual({
      cols: 16,
      rows: 16,
      texelsU: 16,
      texelsV: 16,
    });
  });

  it('swaps grid axes for face rotation 90 and 270', () => {
    const warnings: string[] = [];
    // 4 宽 × 8 高的区域
    // 4 wide, 8 tall region
    expect(faceGridSize(face('north', [0, 0, 4, 8]), tex64, warnings)).toEqual({
      cols: 4,
      rows: 8,
      texelsU: 4,
      texelsV: 8,
    });
    expect(faceGridSize(face('north', [0, 0, 4, 8], 90), tex64, warnings)).toEqual({
      cols: 8,
      rows: 4,
      texelsU: 4,
      texelsV: 8,
    });
    expect(faceGridSize(face('north', [0, 0, 4, 8], 270), tex64, warnings)).toEqual({
      cols: 8,
      rows: 4,
      texelsU: 4,
      texelsV: 8,
    });
  });

  it('rejects non-integer texel spans instead of rounding silently', () => {
    const warnings: string[] = [];
    expect(faceGridSize(face('north', [8, 8, 16.5, 16]), tex64, warnings)).toBeNull();
    expect(warnings[0]).toMatch(/non-integer texel counts/);
  });

  it('warns when the UV rect exceeds the texture bounds', () => {
    const warnings: string[] = [];
    faceGridSize(face('north', [60, 8, 70, 16]), tex64, warnings);
    expect(warnings[0]).toMatch(/exceeds the texture bounds/);
  });
});

describe('sampleCell', () => {
  const tex64 = makeTexture(64, 64, () => [0, 0, 0, 255]);
  const grid8 = { cols: 8, rows: 8, texelsU: 8, texelsV: 8 };

  it('maps the first grid cell to the top-left region pixel', () => {
    const s = sampleCell(face('north', [40, 8, 48, 16]), [40, 8, 48, 16], tex64, 1, 1, grid8, 0, 0);
    expect([s.imageX, s.imageY]).toEqual([40, 8]);
    expect(s.pixelUV).toEqual([40, 8, 41, 9]);
  });

  it('maps the last grid cell to the bottom-right region pixel', () => {
    const s = sampleCell(face('north', [40, 8, 48, 16]), [40, 8, 48, 16], tex64, 1, 1, grid8, 7, 7);
    expect([s.imageX, s.imageY]).toEqual([47, 15]);
  });

  it('preserves reversed U direction instead of normalizing', () => {
    const uv: UVRect = [48, 8, 40, 16];
    const first = sampleCell(face('north', uv), uv, tex64, 1, 1, grid8, 0, 0);
    const last = sampleCell(face('north', uv), uv, tex64, 1, 1, grid8, 7, 0);
    expect([first.imageX, first.imageY]).toEqual([47, 8]);
    expect([last.imageX, last.imageY]).toEqual([40, 8]);
  });

  it('preserves reversed V direction', () => {
    const uv: UVRect = [40, 16, 48, 8];
    const first = sampleCell(face('north', uv), uv, tex64, 1, 1, grid8, 0, 0);
    expect([first.imageX, first.imageY]).toEqual([40, 15]);
  });

  it('samples through face rotation 90 by transposing the region', () => {
    // 2×4 区域，旋转 90 度后：网格为 4 列 × 2 行
    // 2x4 region, rotated: grid is 4 cols x 2 rows
    const uv: UVRect = [0, 0, 2, 4];
    const grid = { cols: 4, rows: 2, texelsU: 2, texelsV: 4 };
    const s = sampleCell(face('north', uv, 90), uv, tex64, 1, 1, grid, 0, 0);
    // mx=0.125, my=0.25 → pu=my=0.25, pv=1-mx=0.875 → u=0.5, v=3.5
    // mx=0.125, my=0.25 -> pu=my=0.25, pv=1-mx=0.875 -> u=0.5, v=3.5
    expect([s.imageX, s.imageY]).toEqual([0, 3]);
  });

  it('clamps sampling into the texture for out-of-bounds rects', () => {
    const s = sampleCell(face('north', [63, 8, 71, 16]), [63, 8, 71, 16], tex64, 1, 1, grid8, 7, 7);
    expect(s.imageX).toBeLessThanOrEqual(63);
    expect(s.imageY).toBeLessThanOrEqual(15);
  });
});

describe('enumerateVisibleTexels', () => {
  it('keeps cells whose alpha is above the threshold', () => {
    // [0,0,2,2] 的 2×2 面区域；alpha 分布：255, 0 / 1, 128
    // 2x2 face region at [0,0,2,2]; alpha pattern: 255, 0 / 1, 128
    const tex = makeTexture(4, 4, (x, y) => {
      if (x < 2 && y < 2) {
        const alpha = [[255, 0], [1, 128]][y][x];
        return [255, 255, 255, alpha];
      }
      return [0, 0, 0, 0];
    });
    const scan = enumerateVisibleTexels(face('north', [0, 0, 2, 2]), tex, 0);
    expect(scan.cells.map(c => [c.col, c.row, c.alpha])).toEqual([
      [0, 0, 255],
      [0, 1, 1],
      [1, 1, 128],
    ]);
  });

  it('honors a raised alpha threshold', () => {
    const tex = makeTexture(4, 4, (x, y) => {
      if (x < 2 && y < 2) {
        const alpha = [[255, 0], [1, 128]][y][x];
        return [255, 255, 255, alpha];
      }
      return [0, 0, 0, 0];
    });
    const scan = enumerateVisibleTexels(face('north', [0, 0, 2, 2]), tex, 128);
    expect(scan.cells.map(c => c.alpha)).toEqual([255]);
  });

  it('returns an empty scan for a degenerate UV rect', () => {
    const tex = makeTexture(4, 4, () => [0, 0, 0, 255]);
    const scan = enumerateVisibleTexels(face('north', [1, 1, 1, 2]), tex, 0);
    expect(scan.cells).toEqual([]);
    expect(scan.warnings[0]).toMatch(/spans no texels/);
  });
});
