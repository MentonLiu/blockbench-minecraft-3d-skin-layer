import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { loadFixtureModel } from '../helpers/referenceModel';
import type { FixtureModel } from '../helpers/referenceModel';

// 黄金数字来自 skins_model_root.bbmodel（模型外再套一层根分组，内嵌 12 张
// 128×128 纹理而 UV 空间仍为 64×64，层立方体统一引用 5.png；alpha 阈值 0）。
// 与 scripts 同算法的离线扫描（min 角矩形逐像素 alpha）得出下列数字。
// Golden numbers characterized from skins_model_root.bbmodel (the whole model
// wrapped in an extra root group; 12 embedded 128x128 textures with a 64x64 UV
// space; every layer face references 5.png; alpha threshold 0). Computed
// offline with the same whole-texel alpha scan the planner performs.
const EXPECTED_PER_LAYER: Record<string, number> = {
  'Hat Layer': 861,
  'Body Layer': 621,
  'Right Arm Layer': 288,
  'Left Arm Layer': 288,
  'Right Leg Layer': 375,
  'Left Leg Layer': 395,
};

const EXPECTED_PER_FACE: Record<string, Record<string, number>> = {
  'Hat Layer': { north: 142, east: 144, south: 204, west: 144, up: 227, down: 0 },
  'Body Layer': { north: 174, east: 32, south: 255, west: 32, up: 128, down: 0 },
  'Right Arm Layer': { north: 56, east: 56, south: 56, west: 56, up: 64, down: 0 },
  'Left Arm Layer': { north: 56, east: 56, south: 56, west: 56, up: 64, down: 0 },
  'Right Leg Layer': { north: 57, east: 144, south: 30, west: 144, up: 0, down: 0 },
  'Left Leg Layer': { north: 57, east: 144, south: 50, west: 144, up: 0, down: 0 },
};

/** 大纲树中某立方体的嵌套深度（根分组的孩子为 1）/ Outliner depth of a cube (root group's children = 1). */
function depthOf(raw: FixtureModel['raw'], uuid: string): number {
  const walk = (nodes: unknown[], depth: number): number => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        if (node === uuid) {
          return depth;
        }
      } else {
        const found = walk((node as { children?: unknown[] }).children ?? [], depth + 1);
        if (found > 0) {
          return found;
        }
      }
    }
    return 0;
  };
  return walk(raw.outliner, 0);
}

describe('root-wrapped model conversion (skins_model_root.bbmodel)', () => {
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
    for (const snapshot of model.snapshots) {
      // 整个模型包在唯一的顶层根分组里：每个层立方体至少嵌套两层
      // （原版模板的腿部层直接挂在顶层分组下）。
      // the whole model is wrapped in one top-level root group: every layer
      // cube sits at least two levels deep (the original template hangs the
      // leg layers directly under a top-level group).
      expect(depthOf(model.raw, snapshot.key)).toBeGreaterThanOrEqual(2);
    }
    expect(model.raw.outliner).toHaveLength(1);
  });

  it('plans 2828 voxel cubes in total', () => {
    expect(warnings).toEqual([]);
    expect(countPlanVoxels(plans)).toBe(2828);
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

  it('resolves the layer texture from the 12-texture project (5.png at 2x scale)', () => {
    expect(model.textures.size).toBe(12);
    const referenced = new Set(
      model.snapshots.flatMap(snapshot => snapshot.faces.map(face => face.textureKey as string)),
    );
    expect(referenced.size).toBe(1);
    const textureKey = [...referenced][0];
    const texture = model.textures.get(textureKey)!;
    const textureJson = model.raw.textures.find(item => item.uuid === textureKey)!;
    expect(textureJson.name).toBe('5.png');
    // 128×128 图像 / 64×64 UV 空间 → 每个图像像素占 0.5 个 UV 单位
    // 128x128 image over a 64x64 UV space -> one image pixel spans 0.5 UV units
    expect(texture.width).toBe(128);
    expect(texture.uvWidth).toBe(64);
    for (const plan of plans) {
      for (const voxel of plan.voxels) {
        expect(voxel.pixelUV[2] - voxel.pixelUV[0]).toBeCloseTo(0.5, 10);
        expect(voxel.pixelUV[3] - voxel.pixelUV[1]).toBeCloseTo(0.5, 10);
      }
    }
  });

  it('builds 16-wide face grids from the doubled texel density', () => {
    const hat = plans.find(plan => plan.sourceName === 'Hat Layer')!;
    const northColumns = new Set(
      hat.voxels.filter(v => v.face === 'north').map(v => v.name.split('_')[2]),
    );
    expect(northColumns.size).toBe(16);
  });
});
