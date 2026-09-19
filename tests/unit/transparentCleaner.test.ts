import { describe, expect, it } from 'vitest';
import { planTransparentRemovals } from '../../src/blockbench/transparentCleaner';
import type { VoxelPixelRef } from '../../src/blockbench/transparentCleaner';
import type { PixelSource, UVRect } from '../../src/domain/types';

function makeTexture(): PixelSource {
  // 4×4 纹理：alpha 值 0..15 取 (x+y)%2 的棋盘，便于区分位置
  // 4x4 texture with checkerboard alpha so each texel is identifiable
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      rgba[(y * 4 + x) * 4 + 3] = (x + y) % 2 === 0 ? 0 : 255;
    }
  }
  return { width: 4, height: 4, uvWidth: 4, uvHeight: 4, rgba };
}

function ref(name: string, u: number, v: number): VoxelPixelRef {
  return {
    cube: { name },
    name,
    pixelUV: [u, v, u + 1, v + 1] as UVRect,
    textureKey: 'tex',
  };
}

describe('planTransparentRemovals', () => {
  it('removes cubes on transparent texels and keeps opaque ones', () => {
    const plan = planTransparentRemovals(
      [ref('px_north_0_0', 0, 0), ref('px_north_1_0', 1, 0), ref('px_north_1_1', 1, 1)],
      new Map([['tex', makeTexture()]]),
      0,
    );
    // (0,0) 与 (1,1) 是棋盘透明格
    // (0,0) and (1,1) are the transparent checkerboard texels
    expect(plan.removable.map(item => item.name)).toEqual(['px_north_0_0', 'px_north_1_1']);
    expect(plan.keptCount).toBe(1);
    expect(plan.warnings).toEqual([]);
  });

  it('honors the alpha threshold', () => {
    const alphaTexture: PixelSource = {
      width: 1,
      height: 1,
      uvWidth: 1,
      uvHeight: 1,
      rgba: new Uint8ClampedArray([10, 20, 30, 128]),
    };
    const item = ref('px_north_0_0', 0, 0);
    // alpha 128 高于阈值 0 → 保留；低于等于阈值 128 → 移除
    // alpha 128 stays above threshold 0; it goes with threshold 128
    expect(planTransparentRemovals([item], new Map([['tex', alphaTexture]]), 0).removable).toHaveLength(0);
    expect(planTransparentRemovals([item], new Map([['tex', alphaTexture]]), 128).removable).toHaveLength(1);
  });

  it('keeps cubes whose UV is not a single texel and reports them', () => {
    const stretched: VoxelPixelRef = {
      cube: { name: 'px_big' },
      name: 'px_big',
      pixelUV: [0, 0, 2, 2] as UVRect,
      textureKey: 'tex',
    };
    const plan = planTransparentRemovals([stretched], new Map([['tex', makeTexture()]]), 0);
    expect(plan.removable).toHaveLength(0);
    expect(plan.keptCount).toBe(1);
    expect(plan.warnings[0]).toContain('not a single texel');
  });

  it('keeps cubes with missing textures or out-of-bounds samples and reports them', () => {
    const noTexture: VoxelPixelRef = { ...ref('px_no_tex', 0, 0), textureKey: 'gone' };
    const outside: VoxelPixelRef = ref('px_outside', 9, 9);
    const plan = planTransparentRemovals(
      [noTexture, outside],
      new Map([['tex', makeTexture()]]),
      0,
    );
    expect(plan.removable).toHaveLength(0);
    expect(plan.keptCount).toBe(2);
    expect(plan.warnings).toHaveLength(2);
  });
});
