import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { loadReferenceModel } from '../helpers/referenceModel';

// 从提供的参考模型特征化得到的黄金数字
// （skin_model.bbmodel，内嵌 64×64 steve64.png，alpha 阈值 0）。
// Golden numbers characterized from the provided reference model
// (skin_model.bbmodel, embedded 64x64 steve64.png, alpha threshold 0).
const EXPECTED_PER_LAYER: Record<string, number> = {
  'Hat Layer': 168,
  'Body Layer': 168,
  'Right Arm Layer': 136,
  'Left Arm Layer': 136,
  'Right Leg Layer': 136,
  'Left Leg Layer': 136,
};

const EXPECTED_PER_FACE: Record<string, Record<string, number>> = {
  'Hat Layer': { north: 28, east: 28, south: 28, west: 28, up: 28, down: 28 },
  'Body Layer': { north: 36, east: 28, south: 36, west: 28, up: 20, down: 20 },
  'Right Arm Layer': { north: 28, east: 28, south: 28, west: 28, up: 12, down: 12 },
  'Left Arm Layer': { north: 28, east: 28, south: 28, west: 28, up: 12, down: 12 },
  'Right Leg Layer': { north: 28, east: 28, south: 28, west: 28, up: 12, down: 12 },
  'Left Leg Layer': { north: 28, east: 28, south: 28, west: 28, up: 12, down: 12 },
};

describe('reference model conversion', () => {
  const model = loadReferenceModel();

  it('exposes exactly the six expected layer cubes', () => {
    expect(model.snapshots.map(snapshot => snapshot.name)).toEqual([
      'Hat Layer',
      'Body Layer',
      'Right Arm Layer',
      'Left Arm Layer',
      'Right Leg Layer',
      'Left Leg Layer',
    ]);
  });

  it('plans 880 voxel cubes in total', () => {
    const { plans, warnings } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    expect(warnings).toEqual([]);
    expect(countPlanVoxels(plans)).toBe(880);
    for (const plan of plans) {
      expect(plan.visiblePixelCount).toBe(EXPECTED_PER_LAYER[plan.sourceName]);
    }
  });

  it('matches the expected visible texel count per face', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    for (const plan of plans) {
      const expected = EXPECTED_PER_FACE[plan.sourceName];
      for (const direction of Object.keys(expected)) {
        const count = plan.voxels.filter(voxel => voxel.face === direction).length;
        expect(count, `${plan.sourceName}/${direction}`).toBe(expected[direction]);
      }
    }
  });

  it('maps every voxel face to exactly one source pixel (six faces same pixel)', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const { sx, sy } = { sx: model.texture.width / model.texture.uvWidth, sy: model.texture.height / model.texture.uvHeight };
    for (const plan of plans) {
      for (const voxel of plan.voxels) {
        const [u1, v1, u2, v2] = voxel.pixelUV;
        expect(u2 - u1).toBeCloseTo(1 / sx, 10);
        expect(v2 - v1).toBeCloseTo(1 / sy, 10);
        expect(u1).toBeGreaterThanOrEqual(0);
        expect(u2).toBeLessThanOrEqual(model.texture.uvWidth);
        expect(v1).toBeGreaterThanOrEqual(0);
        expect(v2).toBeLessThanOrEqual(model.texture.uvHeight);
      }
    }
  });

  it('sits hat voxels inside the original inflate shell (preserve depth)', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const hat = plans.find(plan => plan.sourceName === 'Hat Layer');
    expect(hat).toBeDefined();
    const north = hat!.voxels.find(v => v.name === 'px_north_0_0')!;
    expect(north.from[2]).toBeCloseTo(-4.501, 10);
    expect(north.to[2]).toBeCloseTo(-4.001, 10);
    const up = hat!.voxels.find(v => v.name === 'px_up_0_0')!;
    expect(up.from[1]).toBeCloseTo(32.001, 10);
    expect(up.to[1]).toBeCloseTo(32.507, 10);
  });

  it('keeps body and legs on their shared waist plane (accepted cross-part)', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const planeOf = (name: string) =>
      plans.find(plan => plan.sourceName === name)!.voxels.find(v => v.name === 'px_north_0_0')!.from[2];
    // 身体与双腿有意共享腰部平面（跨部位重叠已被接受；摆姿势后分离）；
    // 帽子的平面高得多
    // body and both legs share the waist plane on purpose (cross-part overlap
    // is accepted; posing separates them); the hat sits far higher
    expect(planeOf('Body Layer')).toBeCloseTo(-2.251, 10);
    expect(planeOf('Right Leg Layer')).toBeCloseTo(-2.251, 10);
    expect(planeOf('Left Leg Layer')).toBeCloseTo(-2.251, 10);
    expect(planeOf('Hat Layer')).toBeCloseTo(-4.501, 10);
  });

  it('handles the inset leg geometry', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const leg = plans.find(plan => plan.sourceName === 'Right Leg Layer');
    const voxel = leg!.voxels.find(v => v.name === 'px_north_0_0');
    // 膨胀后 x 跨度 [-0.35, 4.15] → 4 列 1.125；第一格位于 +X 边缘
    // inflated x span [-0.35, 4.15] -> 4 texel columns of 1.125; first cell at the +X edge
    expect(voxel?.from[0]).toBeCloseTo(3.025, 10);
    expect(voxel?.to[0]).toBeCloseTo(4.15, 10);
    // 北面体素填满 z 方向的膨胀间隙（standoff 0.001 + 厚度 0.25）
    // north voxels fill the inflate gap in z (standoff 0.001 + depth 0.25)
    expect(voxel?.from[2]).toBeCloseTo(-2.251, 10);
    expect(voxel?.to[2]).toBeCloseTo(-2.001, 10);
    expect(voxel?.pixelUV).toEqual([4, 36, 5, 37]);
  });

  it('inherits the hidden visibility of the source layer cubes', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    for (const plan of plans) {
      expect(plan.visibility).toBe(false);
    }
  });
});
