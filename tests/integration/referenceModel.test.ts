import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { loadReferenceModel } from '../helpers/referenceModel';

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

  it('gives every voxel an integer box UV offset on a 64px skin', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    for (const plan of plans) {
      for (const voxel of plan.voxels) {
        expect(Number.isInteger(voxel.uvOffset[0]), `${plan.sourceName}/${voxel.name}`).toBe(true);
        expect(Number.isInteger(voxel.uvOffset[1]), `${plan.sourceName}/${voxel.name}`).toBe(true);
        expect(voxel.uvOffset[0]).toBeGreaterThanOrEqual(-3);
        expect(voxel.uvOffset[1]).toBeGreaterThanOrEqual(-3);
        expect(voxel.uvOffset[0]).toBeLessThanOrEqual(63);
        expect(voxel.uvOffset[1]).toBeLessThanOrEqual(63);
      }
    }
  });

  it('sits hat voxels exactly one texel proud of the raw box', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const hat = plans.find(plan => plan.sourceName === 'Hat Layer');
    expect(hat).toBeDefined();
    const north = hat!.voxels.find(v => v.name === 'px_north_0_0')!;
    expect(north.from[2]).toBeCloseTo(-5.001, 10);
    expect(north.to[2]).toBeCloseTo(-4.001, 10);
    const up = hat!.voxels.find(v => v.name === 'px_up_0_0')!;
    expect(up.from[1]).toBeCloseTo(32.001, 10);
    expect(up.to[1]).toBeCloseTo(33.001, 10);
  });

  it('lifts every layer by the same uniform standoff', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const planeOf = (name: string) =>
      plans.find(plan => plan.sourceName === name)!.voxels.find(v => v.name === 'px_north_0_0')!.from[2];
    // body and both legs share the waist plane on purpose (cross-part overlap
    // is accepted; posing separates them); the hat sits one texel higher
    expect(planeOf('Body Layer')).toBeCloseTo(-3.001, 10);
    expect(planeOf('Right Leg Layer')).toBeCloseTo(-3.001, 10);
    expect(planeOf('Left Leg Layer')).toBeCloseTo(-3.001, 10);
    expect(planeOf('Hat Layer')).toBeCloseTo(-5.001, 10);
  });

  it('handles the inset leg geometry', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const leg = plans.find(plan => plan.sourceName === 'Right Leg Layer');
    const voxel = leg!.voxels.find(v => v.name === 'px_north_0_0');
    // raw grid [-0.1, 3.9] -> 4 texel columns; first cell at the +X edge
    expect(voxel?.from[0]).toBeCloseTo(2.9, 10);
    expect(voxel?.to[0]).toBeCloseTo(3.9, 10);
    // north voxels lift off the raw front plane by the uniform standoff
    expect(voxel?.from[2]).toBeCloseTo(-3.001, 10);
    expect(voxel?.to[2]).toBeCloseTo(-2.001, 10);
  });

  it('inherits the hidden visibility of the source layer cubes', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    for (const plan of plans) {
      expect(plan.visibility).toBe(false);
    }
  });
});
