import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { loadFixtureModel } from '../helpers/referenceModel';

// 黄金数字来自 skins_model_root_joint.bbmodel（四肢与躯干拆成上下两段的
// 关节模板；层命名带数字后缀，下半段层立方体为逐面 UV 且不含 inflate；
// 层面统一引用 64×64 纹理，alpha 阈值 0）。
// Golden numbers characterized from skins_model_root_joint.bbmodel (a jointed
// template splitting body/arms/legs into upper and lower segments; layer names
// carry digit suffixes, lower-segment layers use per-face UV and often omit
// inflate; layer faces reference the 64x64 texture; alpha threshold 0).
const EXPECTED_PER_LAYER: Record<string, number> = {
  'Hat Layer': 87,
  'Body Layer1': 45,
  'Right Arm Layer1': 18,
  'Left Arm Layer': 25,
  'Right Leg Layer1': 38,
  'Left Leg Layer1': 56,
  'Right Arm Layer2': 25,
  'Body Layer2': 11,
  'Left Arm Layer2': 32,
  'Right Leg Layer2': 24,
  'Left Leg Layer2': 43,
};

const EXPECTED_PER_FACE: Record<string, Record<string, number>> = {
  'Hat Layer': { north: 26, east: 13, south: 17, west: 18, up: 12, down: 1 },
  'Body Layer1': { north: 26, east: 0, south: 17, west: 2, up: 0, down: 0 },
  'Right Arm Layer1': { north: 6, east: 4, south: 4, west: 4, up: 0, down: 0 },
  'Left Arm Layer': { north: 10, east: 4, south: 5, west: 6, up: 0, down: 0 },
  'Right Leg Layer1': { north: 3, east: 17, south: 10, west: 3, up: 4, down: 1 },
  'Left Leg Layer1': { north: 11, east: 3, south: 20, west: 15, up: 6, down: 1 },
  'Right Arm Layer2': { north: 10, east: 0, south: 6, west: 9, up: 0, down: 0 },
  'Body Layer2': { north: 8, east: 0, south: 2, west: 1, up: 0, down: 0 },
  'Left Arm Layer2': { north: 12, east: 7, south: 7, west: 6, up: 0, down: 0 },
  'Right Leg Layer2': { north: 0, east: 12, south: 10, west: 0, up: 1, down: 1 },
  'Left Leg Layer2': { north: 10, east: 0, south: 18, west: 15, up: 0, down: 0 },
};

describe('jointed segment model conversion (skins_model_root_joint.bbmodel)', () => {
  const model = loadFixtureModel('skins_model_root_joint.bbmodel');
  const { plans, warnings } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);

  it('finds all eleven layer cubes including digit-suffixed names', () => {
    expect(model.snapshots.map(snapshot => snapshot.name)).toEqual([
      'Hat Layer',
      'Body Layer1',
      'Right Arm Layer1',
      'Left Arm Layer',
      'Right Leg Layer1',
      'Left Leg Layer1',
      'Right Arm Layer2',
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

  it('plans 404 voxel cubes in total', () => {
    expect(warnings).toEqual([]);
    expect(countPlanVoxels(plans)).toBe(404);
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

  it('keeps segment pivots by copying the layer cube origin onto the plan', () => {
    const body2 = plans.find(plan => plan.sourceName === 'Body Layer2')!;
    expect(body2.origin).toEqual([0, -4, 0]);
    const leg2 = plans.find(plan => plan.sourceName === 'Left Leg Layer2')!;
    expect(leg2.origin).toEqual([-2, 6, 0]);
  });

  it('renders the inflate-0 layer as flat voxel cards instead of degenerate slabs', () => {
    // Body Layer2 没有 inflate：preserve_layer 语义下北面厚度为 0，
    // 得到零厚度平面卡片（Blockbench 渲染为平面，与原共面壳一致）。
    // 北面第一个可见单元格是 (5,0)。
    // Body Layer2 has no inflate: preserve_layer gives the north face zero
    // thickness - flat cards, exactly like the original coplanar shell. The
    // first visible north cell is (5,0).
    const body2 = plans.find(plan => plan.sourceName === 'Body Layer2')!;
    const north = body2.voxels.find(voxel => voxel.name === 'px_north_5_0')!;
    expect(north.from[2]).toBeCloseTo(-2.001, 10);
    expect(north.to[2]).toBeCloseTo(-2.001, 10);
    expect(north.from[0]).toBeCloseTo(-2, 10);
    expect(north.to[0]).toBeCloseTo(-1, 10);
    expect(north.pixelUV).toEqual([25, 44, 26, 45]);
    // 带有 0.25 inflate 的相邻分段层仍产出常规厚度的体素；
    // 该面第一个可见单元格是 (1,0)
    // the neighbouring 0.25-inflate segment layer keeps normal thickness; its
    // first visible north cell is (1,0)
    const arm2 = plans.find(plan => plan.sourceName === 'Right Arm Layer2')!;
    const armNorth = arm2.voxels.find(voxel => voxel.name === 'px_north_1_0')!;
    expect(armNorth.to[2] - armNorth.from[2]).toBeCloseTo(0.25, 10);
    expect(armNorth.pixelUV).toEqual([45, 42, 46, 43]);
  });

  it('samples the reversed UV rects of the lower leg layers', () => {
    // Right Leg Layer2 的顶/底面 UV 两轴均反向（[11,36,7,32]），
    // 反向矩形按镜像采样，仍各产出其可见像素
    // Right Leg Layer2's up/down UV rects are reversed on both axes
    // ([11,36,7,32]) - mirrored sampling still yields every visible texel.
    const leg2 = plans.find(plan => plan.sourceName === 'Right Leg Layer2')!;
    expect(leg2.voxels.filter(voxel => voxel.face === 'up')).toHaveLength(1);
    expect(leg2.voxels.filter(voxel => voxel.face === 'down')).toHaveLength(1);
  });
});
