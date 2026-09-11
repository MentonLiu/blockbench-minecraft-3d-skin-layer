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

  it('fills the inflate gap on the raw box front (preserve depth)', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const voxel = plans[0].voxels.find(v => v.name === 'px_north_0_0');
    // first north cell at the +X top corner; north epsilon is 0
    expect(voxel?.from).toEqual([3.375, 31.375, -4.501]);
    expect(voxel?.to).toEqual([4.5, 32.5, -4.001]);
  });

  it('carries a per-direction epsilon so shell planes stay distinct', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const first = (name: string) => plans[0].voxels.find(v => v.name === name)!;
    // north epsilon 0 -> exact inflate depth 0.5; up epsilon 0.006 -> 0.506
    const north = first('px_north_0_0');
    expect(north.to[2] - north.from[2]).toBeCloseTo(0.5, 10);
    const up = first('px_up_0_0');
    expect(up.to[1] - up.from[1]).toBeCloseTo(0.506, 10);
    expect(up.from[1]).toBeCloseTo(32.001, 10);
    expect(up.to[1]).toBeCloseTo(32.507, 10);
    // east slab sits outside the north grid's east edge (4.5): no shared plane
    const east = first('px_east_0_0');
    expect(east.from[0]).toBeCloseTo(4.001, 10);
    expect(east.to[0]).toBeCloseTo(4.5025, 10);
  });

  it('maps all six faces of a voxel to the same source pixel', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const firstOfFace = (face: string) =>
      plans[0].voxels.find(v => v.name === `px_${face}_0_0`)!.pixelUV;
    const rects = ['north', 'east', 'south', 'west', 'up', 'down'].map(firstOfFace);
    for (const rect of rects) {
      expect(rect).toEqual([40, 8, 41, 9]);
    }
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

  it('never produces coplanar overlapping faces inside one layer', () => {
    const textures = new Map([['texA', opaqueTexture()]]);
    const { plans } = buildVoxelPlans([hatLayer()], textures, opts());
    const buckets = new Map<string, { dir: string; u0: number; u1: number; v0: number; v1: number; name: string }[]>();
    const r6 = (n: number) => Math.round(n * 1e4) / 1e4;
    for (const voxel of plans[0].voxels) {
      for (const face of ['north', 'east', 'south', 'west', 'up', 'down'] as const) {
        let key: string, u0: number, u1: number, v0: number, v1: number;
        if (face === 'north') { key = `z:${r6(voxel.from[2])}:-`; u0 = voxel.from[0]; u1 = voxel.to[0]; v0 = voxel.from[1]; v1 = voxel.to[1]; }
        else if (face === 'south') { key = `z:${r6(voxel.to[2])}:+`; u0 = voxel.from[0]; u1 = voxel.to[0]; v0 = voxel.from[1]; v1 = voxel.to[1]; }
        else if (face === 'west') { key = `x:${r6(voxel.from[0])}:-`; u0 = voxel.from[2]; u1 = voxel.to[2]; v0 = voxel.from[1]; v1 = voxel.to[1]; }
        else if (face === 'east') { key = `x:${r6(voxel.to[0])}:+`; u0 = voxel.from[2]; u1 = voxel.to[2]; v0 = voxel.from[1]; v1 = voxel.to[1]; }
        else if (face === 'down') { key = `y:${r6(voxel.from[1])}:-`; u0 = voxel.from[0]; u1 = voxel.to[0]; v0 = voxel.from[2]; v1 = voxel.to[2]; }
        else { key = `y:${r6(voxel.to[1])}:+`; u0 = voxel.from[0]; u1 = voxel.to[0]; v0 = voxel.from[2]; v1 = voxel.to[2]; }
        const bucket = buckets.get(key);
        const entry = { dir: face, u0, u1, v0, v1, name: voxel.name };
        if (bucket) bucket.push(entry); else buckets.set(key, [entry]);
      }
    }
    let overlaps = 0;
    const samples: string[] = [];
    for (const faces of buckets.values()) {
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const a = faces[i], b = faces[j];
          const du = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
          const dv = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
          if (du > 1e-6 && dv > 1e-6) {
            overlaps++;
            if (samples.length < 4) samples.push(`${a.name} x ${b.name}`);
          }
        }
      }
    }
    expect(overlaps, samples.join(', ')).toBe(0);
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
    expect(rightNorthZ).toBeCloseTo(-2 - VOXEL_STANDOFF - 0.25, 10);
  });
});
