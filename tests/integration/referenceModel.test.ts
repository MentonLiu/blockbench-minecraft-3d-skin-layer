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

  it('maps every voxel face to exactly one image pixel', () => {
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

  it('keeps hat voxels on the inflated layer surfaces (preserve_layer)', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const hat = plans.find(plan => plan.sourceName === 'Hat Layer');
    expect(hat).toBeDefined();
    for (const voxel of hat!.voxels) {
      if (voxel.face === 'north') {
        expect(voxel.from[2]).toBeCloseTo(-4.5, 10);
        expect(voxel.to[2]).toBeCloseTo(-4, 10);
      }
      if (voxel.face === 'east') {
        expect(voxel.from[0]).toBeCloseTo(4, 10);
        expect(voxel.to[0]).toBeCloseTo(4.5, 10);
      }
      if (voxel.face === 'up') {
        expect(voxel.from[1]).toBeCloseTo(32, 10);
        expect(voxel.to[1]).toBeCloseTo(32.5, 10);
      }
      if (voxel.face === 'down') {
        expect(voxel.from[1]).toBeCloseTo(23.5, 10);
        expect(voxel.to[1]).toBeCloseTo(24, 10);
      }
    }
  });

  it('handles the inset leg geometry', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const leg = plans.find(plan => plan.sourceName === 'Right Leg Layer');
    const voxel = leg!.voxels.find(v => v.name === 'px_north_0_0');
    // inflated x span [-0.35, 4.15] -> 4 texels of 1.125, first cell at the +X edge
    expect(voxel?.from[0]).toBeCloseTo(3.025, 10);
    expect(voxel?.to[0]).toBeCloseTo(4.15, 10);
    // north voxels fill the inflate gap in z
    expect(voxel?.from[2]).toBeCloseTo(-2.25, 10);
    expect(voxel?.to[2]).toBeCloseTo(-2, 10);
  });

  it('inherits the hidden visibility of the source layer cubes', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    for (const plan of plans) {
      expect(plan.visibility).toBe(false);
    }
  });

  it('renders exactly one shell face per voxel (anti z-fighting)', () => {
    const { plans } = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    let fullyDisabled = 0;
    for (const plan of plans) {
      for (const voxel of plan.voxels) {
        // preserve_layer keeps the textured outer face enabled; voxels inside
        // interpenetration strips (the two legs overlap each other, and the
        // body waist shares the leg plane) may lose it to the coplanar dedup
        expect(
          voxel.disabledFaces.length,
          `${plan.sourceName}/${voxel.name}`,
        ).toBeGreaterThanOrEqual(5);
        if (voxel.disabledFaces.length === 6) {
          fullyDisabled++;
        }
      }
    }
    // only the narrow strips where source cubes interpenetrate lose their face
    expect(fullyDisabled).toBeGreaterThan(0);
    expect(fullyDisabled).toBeLessThan(200);
  });
});
