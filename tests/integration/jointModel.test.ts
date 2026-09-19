import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { loadFixtureModel } from '../helpers/referenceModel';

// 黄金数字来自 skins_model_root_joint.bbmodel（四肢/躯干上下分段的关节
// 模板；层命名带数字后缀，Body Layer2 无 inflate 且为逐面 UV；内嵌
// temp-64.png 单纹理 64×64，alpha 阈值 0）。
// Golden numbers from skins_model_root_joint.bbmodel (upper/lower segment
// template; digit-suffixed layer names; Body Layer2 without inflate and with
// per-face UV; single embedded temp-64.png 64x64; alpha threshold 0).
const EXPECTED_PER_LAYER: Record<string, number> = {
  'Hat Layer': 266,
  'Body Layer1': 100,
  'Right Arm Layer1': 60,
  'Left Arm Layer': 60,
  'Right Leg Layer1': 16,
  'Left Leg Layer1': 16,
  'Body Layer2': 54,
  'Left Arm Layer2': 40,
  'Right Leg Layer2': 42,
  'Left Leg Layer2': 26,
};

const EXPECTED_PER_FACE: Record<string, Record<string, number>> = {
  'Hat Layer': { north: 28, east: 45, south: 58, west: 35, up: 48, down: 52 },
  'Body Layer1': { north: 28, east: 9, south: 45, west: 8, up: 9, down: 1 },
  'Right Arm Layer1': { north: 14, east: 12, south: 14, west: 12, up: 8, down: 0 },
  'Left Arm Layer': { north: 14, east: 12, south: 14, west: 12, up: 8, down: 0 },
  'Right Leg Layer1': { north: 0, east: 0, south: 0, west: 0, up: 0, down: 16 },
  'Left Leg Layer1': { north: 0, east: 0, south: 0, west: 0, up: 0, down: 16 },
  'Body Layer2': { north: 10, east: 8, south: 18, west: 8, up: 1, down: 9 },
  'Left Arm Layer2': { north: 8, east: 8, south: 8, west: 8, up: 8, down: 0 },
  'Right Leg Layer2': { north: 6, east: 4, south: 4, west: 4, up: 12, down: 12 },
  'Left Leg Layer2': { north: 2, east: 0, south: 0, west: 0, up: 12, down: 12 },
};

const FULL_PIXEL_TOTAL = 1792;

describe('jointed segment template conversion (skins_model_root_joint.bbmodel)', () => {
  const model = loadFixtureModel('skins_model_root_joint.bbmodel');
  const { plans, warnings } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);

  it('finds all ten layer cubes including digit-suffixed names', () => {
    expect(model.snapshots.map(snapshot => snapshot.name)).toEqual([
      'Hat Layer',
      'Body Layer1',
      'Right Arm Layer1',
      'Left Arm Layer',
      'Right Leg Layer1',
      'Left Leg Layer1',
      'Body Layer2',
      'Left Arm Layer2',
      'Right Leg Layer2',
      'Left Leg Layer2',
    ]);
  });

  it('captures the per-face UVs of the box_uv=false segment layers', () => {
    const body2 = model.snapshots.find(snapshot => snapshot.name === 'Body Layer2')!;
    expect(body2.inflate).toBe(0);
    expect(body2.faces).toHaveLength(6);
    // 来自 bbmodel 的逐面 UV（非 box UV 推导）
    // per-face UVs straight from the bbmodel (not derived from box UV)
    expect(body2.faces.find(face => face.direction === 'north')!.uv).toEqual([20, 44, 28, 48]);
    const leg2 = model.snapshots.find(snapshot => snapshot.name === 'Left Leg Layer2')!;
    expect(leg2.inflate).toBe(0.25);
    expect(leg2.origin).toEqual([-2, 6, 0]);
  });

  it('plans 680 visible voxel cubes in total', () => {
    expect(warnings).toEqual([]);
    expect(countPlanVoxels(plans)).toBe(680);
    for (const plan of plans) {
      expect(plan.visiblePixelCount).toBe(EXPECTED_PER_LAYER[plan.sourceName]);
    }
  });

  it('matches the expected visible texel count per face', () => {
    for (const plan of plans) {
      const expected = EXPECTED_PER_FACE[plan.sourceName];
      for (const direction of Object.keys(expected)) {
        const count = plan.voxels.filter(voxel => voxel.face === direction).length;
        expect(count, `${plan.sourceName}/${direction}`).toBe(expected[direction]);
      }
    }
  });

  it('plans every grid cell when includeTransparent is set', () => {
    const full = buildVoxelPlans(model.snapshots, model.textures, {
      ...DEFAULT_OPTIONS,
      includeTransparent: true,
    });
    expect(full.warnings).toEqual([]);
    expect(countPlanVoxels(full.plans)).toBe(FULL_PIXEL_TOTAL);
    expect(countPlanVoxels(full.plans)).toBeGreaterThan(countPlanVoxels(plans));
  });

  it('renders the inflate-0 layer as flat voxel cards instead of degenerate slabs', () => {
    // Body Layer2 没有 inflate：preserve_layer 语义下北面厚度为 0。
    // 北面 UV [20,44,28,48] 从 (20,44) 开始，第一个可见单元格是 (2,0)。
    // Body Layer2 has no inflate: preserve_layer gives the north face zero
    // thickness. North UV [20,44,28,48] starts at (20,44); the first visible
    // cell is (2,0).
    const body2 = plans.find(plan => plan.sourceName === 'Body Layer2')!;
    const north = body2.voxels.find(voxel => voxel.name === 'px_north_2_0')!;
    expect(north.from[2]).toBeCloseTo(-2.001, 10);
    expect(north.to[2]).toBeCloseTo(-2.001, 10);
    // 北面 U 轴从 +X 向 -X（与 UVToLocal 一致）：单元格 (2,0) 在 x∈[1,2]
    // the north U axis runs from +X to -X (UVToLocal): cell (2,0) spans x [1,2]
    expect(north.from[0]).toBeCloseTo(1, 10);
    expect(north.to[0]).toBeCloseTo(2, 10);
    expect(north.pixelUV).toEqual([22, 44, 23, 45]);
  });

  it('keeps segment pivots by copying the layer cube origin onto the plan', () => {
    const body2 = plans.find(plan => plan.sourceName === 'Body Layer2')!;
    expect(body2.origin).toEqual([0, -4, 0]);
    const leg2 = plans.find(plan => plan.sourceName === 'Left Leg Layer2')!;
    expect(leg2.origin).toEqual([-2, 6, 0]);
  });
});
