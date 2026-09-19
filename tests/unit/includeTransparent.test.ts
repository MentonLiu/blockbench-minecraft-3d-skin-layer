import { describe, expect, it } from 'vitest';
import { enumerateVisibleTexels } from '../../src/texture/pixelReader';
import type { FaceSnapshot, PixelSource, UVRect } from '../../src/domain/types';

function makeTexture(): PixelSource {
  // 4×4 纹理：三格不透明，(0,0) 全透明
  // 4x4 texture: three opaque texels, (0,0) fully transparent
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    rgba[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  return { width: 4, height: 4, uvWidth: 4, uvHeight: 4, rgba };
}

const face: FaceSnapshot = {
  direction: 'north',
  enabled: true,
  textureKey: 'tex',
  uv: [0, 0, 4, 4] as UVRect,
  rotation: 0,
};

describe('enumerateVisibleTexels with includeTransparent', () => {
  it('skips transparent texels by default', () => {
    const scan = enumerateVisibleTexels(face, makeTexture(), 0);
    expect(scan.cells).toHaveLength(15);
    expect(scan.warnings).toEqual([]);
  });

  it('includes transparent texels when includeTransparent is set', () => {
    const scan = enumerateVisibleTexels(face, makeTexture(), 0, true);
    expect(scan.cells).toHaveLength(16);
    // 透明单元格仍携带自己的像素 UV，供后续"清除透明方块"定位
    // the transparent cell still carries its own pixel UV for later cleanup
    const transparent = scan.cells.find(cell => cell.col === 0 && cell.row === 0)!;
    expect(transparent.alpha).toBe(0);
    expect(transparent.pixelUV).toEqual([0, 0, 1, 1]);
  });

  it('still respects non-integer texel span warnings in includeTransparent mode', () => {
    const badFace: FaceSnapshot = { ...face, uv: [0, 0, 2.5, 4] as UVRect };
    const scan = enumerateVisibleTexels(badFace, makeTexture(), 0, true);
    expect(scan.cells).toHaveLength(0);
    expect(scan.warnings.length).toBeGreaterThan(0);
  });
});
