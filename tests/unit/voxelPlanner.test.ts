import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import type { GeneratorOptions, LayerSnapshot, PixelSource, UVRect } from '../../src/domain/types';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';

function opaqueTexture(alphaAt?: (x: number, y: number) => number): PixelSource {
  const rgba = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const a = alphaAt ? alphaAt(x, y) : 255;
      const i = (y * 64 + x) * 4;
      rgba[i] = 200;
      rgba[i + 1] = 100;
      rgba[i + 2] = 50;
      rgba[i + 3] = a;
    }
  }
  return { width: 64, height: 64, uvWidth: 64, uvHeight: 64, rgba };
}

const ALL_FACES_UV: UVRect = [40, 8, 48, 16];

function hatLayer(inflate = 0.5): LayerSnapshot {
  return {
    key: 'uuid-hat',
    name: 'Hat Layer',
    from: [-4, 24, -4],
    to: [4, 32, 4],
    inflate,
    stretch: [1, 1, 1],
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    visibility: false,
    faces: (['north', 'east', 'south', 'west', 'up', 'down'] as const).map(direction => ({
      direction,
      enabled: true,
      textureKey: 'texA',
      uv: [...ALL_FACES_UV] as UVRect,
      rotation: 0 as const,
    })),
  };
}

const opts = (overrides: Partial<GeneratorOptions> = {}): GeneratorOptions => ({
  ...DEFAULT_OPTIONS,
  ...overrides,
});

describe('buildVoxelPlans', () => {
  it('plans one voxel per visible texel of an opaque 64px skin', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans, warnings } = buildVoxelPlans([hatLayer()], textures, opts());
    expect(warnings).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0].sourceKey).toBe('uuid-hat');
    expect(plans[0].sourceName).toBe('Hat Layer');
    expect(plans[0].visiblePixelCount).toBe(384); // 6 faces x 8x8
    expect(countPlanVoxels(plans)).toBe(384);
  });

  it('names voxels by face and grid position', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const names = plans[0].voxels.map(v => v.name);
    expect(names).toContain('px_north_0_0');
    expect(names).toContain('px_north_7_7');
    expect(names).toContain('px_down_7_7');
    expect(new Set(names).size).toBe(names.length);
  });

  it('places the first north voxel at the top-left of the inflated front face', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const voxel = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    expect(voxel?.from).toEqual([3.375, 31.375, -4.5]);
    expect(voxel?.to).toEqual([4.5, 32.5, -4]);
  });

  it('disables the inner face and duplicate shell faces (preserve_layer)', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const corner = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    expect(corner?.disabledFaces).toEqual(['east', 'south', 'up']);
    const middle = plans[0].voxels.find(v => v.name === 'px_north_3_3');
    expect(middle?.disabledFaces).toEqual(['south']);
  });

  it('keeps shell side faces when pixel depth separates the shells', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts({ depthMode: 'pixel' }));
    const corner = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    expect(corner?.disabledFaces).toEqual(['south']);
  });

  it('gives every voxel the single-texel UV and the source transform', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    for (const voxel of plans[0].voxels) {
      const [u1, v1, u2, v2] = voxel.pixelUV;
      expect(u2 - u1).toBeCloseTo(1, 10);
      expect(v2 - v1).toBeCloseTo(1, 10);
      expect(u1).toBeGreaterThanOrEqual(0);
      expect(v1).toBeGreaterThanOrEqual(0);
      expect(u2).toBeLessThanOrEqual(64);
      expect(voxel.origin).toEqual([0, 0, 0]);
      expect(voxel.rotation).toEqual([0, 0, 0]);
      expect(voxel.textureKey).toBe('texA');
    }
  });

  it('keeps all faces of a voxel on the same image pixel', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const byPixel = new Map<string, number>();
    for (const voxel of plans[0].voxels) {
      const key = voxel.pixelUV.join(',');
      byPixel.set(key, (byPixel.get(key) ?? 0) + 1);
    }
    // 6 faces x 64 pixels, each image pixel used exactly 6 times (once per face direction)
    for (const count of byPixel.values()) {
      expect(count).toBe(6);
    }
  });

  it('skips transparent texels', () => {
    // right half of the sampled region [40..48, 8..16] is transparent:
    // each face keeps 4x8 = 32 cells, 6 faces -> 192 voxels
    const textures = new Map([
      ['texA', opaqueTexture((x, y) => (x >= 44 && x < 48 && y >= 8 && y < 16 ? 0 : 255))],
    ]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    expect(countPlanVoxels(plans)).toBe(192);
  });

  it('honors the alpha threshold', () => {
    const textures = new Map([['texA', opaqueTexture((x, y) => (x === 40 && y === 8 ? 128 : 255))]]);
    const full = buildVoxelPlans([hatLayer()], textures, opts({ alphaThreshold: 0 }));
    const strict = buildVoxelPlans([hatLayer()], textures, opts({ alphaThreshold: 128 }));
    expect(countPlanVoxels(full.plans)).toBe(384);
    // pixel (40,8) is sampled once per face direction -> 6 voxels removed
    expect(countPlanVoxels(strict.plans)).toBe(378);
  });

  it('leaves fully transparent layers untouched by default', () => {
    const textures = new Map([['texA', opaqueTexture(() => 0)]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    expect(plans).toHaveLength(0);
  });

  it('replaces fully transparent layers when replaceEmptyLayer is set', () => {
    const textures = new Map([['texA', opaqueTexture(() => 0)]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts({ replaceEmptyLayer: true }));
    expect(plans).toHaveLength(1);
    expect(plans[0].voxels).toHaveLength(0);
  });

  it('warns and skips faces without a usable texture', () => {
    const textures = new Map<string, PixelSource>();
    const { plans, warnings } = buildVoxelPlans([hatLayer()], textures, opts());
    expect(plans).toHaveLength(0);
    expect(warnings.filter(w => w.includes('no usable texture'))).toHaveLength(6);
  });

  it('supports per-face textures', () => {
    const layer = hatLayer();
    layer.faces = layer.faces.map(face =>
      face.direction === 'north' ? { ...face, textureKey: 'texB' } : face,
    );
    const textures = new Map<string, PixelSource>([
      ['texA', opaqueTexture(() => 0)],
      ['texB', opaqueTexture()],
    ]);
    const { plans } = buildVoxelPlans([layer], textures, opts());
    expect(countPlanVoxels(plans)).toBe(64);
    expect(plans[0].voxels.every(v => v.textureKey === 'texB')).toBe(true);
  });

  it('uses pixel depth when depthMode is pixel', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts({ depthMode: 'pixel' }));
    const voxel = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    expect(voxel?.from[2]).toBeCloseTo(-5.125, 10); // -4 - 1.125
    expect(voxel?.to[2]).toBeCloseTo(-4, 10);
  });

  it('uses fixed depth when depthMode is fixed', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts({ depthMode: 'fixed', fixedDepth: 0.1 }));
    const voxel = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    expect(voxel?.from[2]).toBeCloseTo(-4.1, 10);
  });
});
