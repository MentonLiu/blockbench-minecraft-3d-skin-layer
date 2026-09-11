import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import type { LayerSnapshot, PixelSource, UVRect } from '../../src/domain/types';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';

/**
 * Doubling the image resolution while the UV coordinate space stays 64 must
 * double the texel grid (head front 8x8 -> 16x16) without any special-casing.
 */
describe('doubled texture resolution (128px image, 64 UV space)', () => {
  function makeHiResTexture(): PixelSource {
    const rgba = new Uint8ClampedArray(128 * 128 * 4);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        // opaque front region [16..32) x [16..32) = the 2x head front [8,8,16,16],
        // opaque top region [16..32) x [0..16) = the 2x head top, checkerboard alpha elsewhere
        const inFront = x >= 16 && x < 32 && y >= 16 && y < 32;
        const inTop = x >= 16 && x < 32 && y < 16;
        const alpha = inFront || inTop ? 255 : (x + y) % 2 === 0 ? 255 : 0;
        const i = (y * 128 + x) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = alpha;
      }
    }
    return { width: 128, height: 128, uvWidth: 64, uvHeight: 64, rgba };
  }

  const layer: LayerSnapshot = {
    key: 'hi-res-head',
    name: 'Hat Layer',
    from: [-4, 24, -4],
    to: [4, 32, 4],
    inflate: 0.5,
    stretch: [1, 1, 1],
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    visibility: false,
    faces: [
      {
        direction: 'north',
        enabled: true,
        textureKey: 'hires',
        uv: [8, 8, 16, 16] as UVRect,
        rotation: 0,
      },
      {
        direction: 'up',
        enabled: true,
        textureKey: 'hires',
        uv: [16, 8, 8, 0] as UVRect,
        rotation: 0,
      },
    ],
  };

  it('renders a 16x16 grid for the head front', () => {
    const { plans } = buildVoxelPlans(
      [layer],
      new Map([['hires', makeHiResTexture()]]),
      DEFAULT_OPTIONS,
    );
    const north = plans[0].voxels.filter(voxel => voxel.face === 'north');
    expect(north).toHaveLength(16 * 16);
    const cols = new Set(north.map(voxel => voxel.name.split('_')[3]));
    expect(cols.size).toBe(16);
  });

  it('keeps the reversed top-face UV working at 2x', () => {
    const { plans } = buildVoxelPlans(
      [layer],
      new Map([['hires', makeHiResTexture()]]),
      DEFAULT_OPTIONS,
    );
    const up = plans[0].voxels.filter(voxel => voxel.face === 'up');
    expect(up).toHaveLength(16 * 16);
  });

  it('maps each voxel to a half-UV-unit pixel rectangle', () => {
    const { plans } = buildVoxelPlans(
      [layer],
      new Map([['hires', makeHiResTexture()]]),
      DEFAULT_OPTIONS,
    );
    expect(countPlanVoxels(plans)).toBe(512);
    for (const voxel of plans[0].voxels) {
      const [u1, v1, u2, v2] = voxel.pixelUV;
      expect(u2 - u1).toBeCloseTo(0.5, 10);
      expect(v2 - v1).toBeCloseTo(0.5, 10);
    }
  });

  it('shrinks voxel face size to 0.5 model units at 2x', () => {
    const { plans } = buildVoxelPlans(
      [layer],
      new Map([['hires', makeHiResTexture()]]),
      DEFAULT_OPTIONS,
    );
    const first = plans[0].voxels.find(voxel => voxel.face === 'north')!;
    expect(first.to[0] - first.from[0]).toBeCloseTo(0.5625, 10); // 9/16
    expect(first.to[1] - first.from[1]).toBeCloseTo(0.5625, 10);
  });
});
