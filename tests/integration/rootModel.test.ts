import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { loadFixtureModel } from '../helpers/referenceModel';

// 黄金数字来自 skins_model_root.bbmodel（整体包一层根分组的模板，内嵌
// temp-64.png 单纹理 64×64、UV 64×64；alpha 阈值 0）。可见数字由整像素
// alpha 扫描刻画；全像素数字 = 每面网格单元格总数（includeTransparent）。
// Golden numbers from skins_model_root.bbmodel (root-wrapped template,
// single embedded temp-64.png 64x64 over a 64x64 UV space; alpha threshold
// 0). Visible numbers characterized by the whole-texel alpha scan; full
// numbers count every grid cell (includeTransparent).
const EXPECTED_PER_LAYER: Record<string, number> = {
  'Hat Layer': 266,
  'Body Layer': 100,
  'Right Arm Layer': 92,
  'Left Arm Layer': 92,
  'Right Leg Layer': 34,
  'Left Leg Layer': 34,
};

const EXPECTED_PER_FACE: Record<string, Record<string, number>> = {
  'Hat Layer': { north: 28, east: 45, south: 58, west: 35, up: 48, down: 52 },
  'Body Layer': { north: 28, east: 9, south: 45, west: 8, up: 9, down: 1 },
  'Right Arm Layer': { north: 22, east: 20, south: 22, west: 20, up: 8, down: 0 },
  'Left Arm Layer': { north: 22, east: 20, south: 22, west: 20, up: 8, down: 0 },
  'Right Leg Layer': { north: 6, east: 4, south: 4, west: 4, up: 0, down: 16 },
  'Left Leg Layer': { north: 6, east: 4, south: 4, west: 4, up: 0, down: 16 },
};

const FULL_PIXEL_TOTAL = 1632;

describe('root-wrapped template conversion (skins_model_root.bbmodel)', () => {
  const model = loadFixtureModel('skins_model_root.bbmodel');
  const { plans, warnings } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);

  it('finds the six standard layer cubes below the extra root group', () => {
    expect(model.snapshots.map(snapshot => snapshot.name)).toEqual([
      'Hat Layer',
      'Body Layer',
      'Right Arm Layer',
      'Left Arm Layer',
      'Right Leg Layer',
      'Left Leg Layer',
    ]);
    // 整个模型包在唯一的顶层根分组里
    // the whole model is wrapped in one top-level root group
    expect(model.raw.outliner).toHaveLength(1);
  });

  it('plans 618 visible voxel cubes in total', () => {
    expect(warnings).toEqual([]);
    expect(countPlanVoxels(plans)).toBe(618);
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
    // 透明像素也进入计划：全像素数量恒大于可见数量
    // transparent pixels join the plan: the full count exceeds the visible one
    expect(countPlanVoxels(full.plans)).toBeGreaterThan(countPlanVoxels(plans));
  });

  it('resolves the single embedded temp texture at 1x scale', () => {
    expect(model.textures.size).toBe(1);
    const textureKey = model.textureKeys[0];
    const texture = model.textures.get(textureKey)!;
    const textureJson = model.raw.textures.find(item => item.uuid === textureKey)!;
    expect(textureJson.name).toBe('temp-64.png');
    expect(texture.width).toBe(64);
    expect(texture.uvWidth).toBe(64);
    for (const plan of plans) {
      for (const voxel of plan.voxels) {
        expect(voxel.pixelUV[2] - voxel.pixelUV[0]).toBeCloseTo(1, 10);
        expect(voxel.pixelUV[3] - voxel.pixelUV[1]).toBeCloseTo(1, 10);
      }
    }
  });
});
