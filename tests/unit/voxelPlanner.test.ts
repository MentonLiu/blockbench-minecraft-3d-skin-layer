import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, VOXEL_STANDOFF } from '../../src/domain/constants';
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

  it('places unit cubes on the raw box, lifted by the standoff', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const voxel = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    // first north cell at the +X top corner of the raw box front
    expect(voxel?.from).toEqual([3, 31, -4 - VOXEL_STANDOFF - 1]);
    expect(voxel?.to).toEqual([4, 32, -4 - VOXEL_STANDOFF]);
  });

  it('builds true unit cubes', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    for (const voxel of plans[0].voxels) {
      expect(voxel.to[0] - voxel.from[0]).toBeCloseTo(1, 10);
      expect(voxel.to[1] - voxel.from[1]).toBeCloseTo(1, 10);
      expect(voxel.to[2] - voxel.from[2]).toBeCloseTo(1, 10);
    }
  });

  it('chooses the box UV offset so the shell face samples its own pixel', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    // hat faces all sample the region at (40, 8); first cell of each face:
    const byName = (name: string) => plans[0].voxels.find(v => v.name === name)!.uvOffset;
    expect(byName('px_north_0_0')).toEqual([39, 7]); // north rect at offset+(1,1)
    expect(byName('px_south_0_0')).toEqual([37, 7]); // south rect at offset+(3,1)
    expect(byName('px_east_0_0')).toEqual([40, 7]); // east rect at offset+(0,1)
    expect(byName('px_west_0_0')).toEqual([38, 7]); // west rect at offset+(2,1)
    expect(byName('px_up_0_0')).toEqual([39, 8]); // up rect at offset+(1,0)
    expect(byName('px_down_7_7')).toEqual([45, 15]); // down rect at offset+(2,0) for its pixel (47,15)
  });

  it('copies the source transform onto every voxel', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    for (const voxel of plans[0].voxels) {
      expect(voxel.origin).toEqual([0, 0, 0]);
      expect(voxel.rotation).toEqual([0, 0, 0]);
      expect(voxel.textureKey).toBe('texA');
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

  it('lets different parts keep their shared planes (accepted overlap)', () => {
    // the reference legs interpenetrate in the default pose; the user accepts
    // that cross-part ghosting (posing separates the parts again), so the
    // standoff stays uniform and the legs keep the same north plane
    const right: LayerSnapshot = {
      ...hatLayer(),
      key: 'leg-right',
      name: 'Right Leg Layer',
      from: [-0.1, 0, -2],
      to: [3.9, 12, 2],
      inflate: 0.25,
    };
    const left: LayerSnapshot = {
      ...hatLayer(),
      key: 'leg-left',
      name: 'Left Leg Layer',
      from: [-3.9, 0, -2],
      to: [0.1, 12, 2],
      inflate: 0.25,
    };
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([right, left], textures, opts());
    const rightNorthZ = plans[0].voxels.find(v => v.name === 'px_north_0_0')!.from[2];
    const leftNorthZ = plans[1].voxels.find(v => v.name === 'px_north_0_0')!.from[2];
    expect(rightNorthZ).toBe(leftNorthZ);
    expect(rightNorthZ).toBeCloseTo(-2 - VOXEL_STANDOFF - 1, 10);
  });
});
