import { describe, expect, it } from 'vitest';
import type { GeneratorOptions } from '../../src/domain/types';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { adjustedBox, facePoint, faceSpans, resolveDisabledFaces, voxelBounds } from '../../src/geometry/faceMapper';
import { resolveDepth } from '../../src/geometry/depthStrategy';

// Hat layer of the reference model: 8x8x8 cube with inflate 0.5
const hatFrom: [number, number, number] = [-4, 24, -4];
const hatTo: [number, number, number] = [4, 32, 4];
const hat = adjustedBox(hatFrom, hatTo, 0.5, [1, 1, 1]);

describe('adjustedBox', () => {
  it('expands by inflate on all axes', () => {
    expect(hat.inflated.from).toEqual([-4.5, 23.5, -4.5]);
    expect(hat.inflated.to).toEqual([4.5, 32.5, 4.5]);
    expect(hat.raw.from).toEqual(hatFrom);
  });

  it('applies stretch around the center', () => {
    const stretched = adjustedBox(hatFrom, hatTo, 0.5, [2, 1, 1]);
    expect(stretched.inflated.from[0]).toBe(-9);
    expect(stretched.inflated.to[0]).toBe(9);
    expect(stretched.inflated.from[1]).toBe(23.5);
  });
});

describe('faceSpans', () => {
  it('uses the inflated box', () => {
    expect(faceSpans('north', hat)).toEqual({ uSpan: 9, vSpan: 9 });
    expect(faceSpans('east', hat)).toEqual({ uSpan: 9, vSpan: 9 });
    expect(faceSpans('up', hat)).toEqual({ uSpan: 9, vSpan: 9 });
  });
});

describe('facePoint follows CubeFace.UVToLocal', () => {
  it('north: u1 at to.x, v1 at to.y, plane at inflated from.z', () => {
    expect(facePoint('north', hat, 0, 0)).toEqual([4.5, 32.5, -4.5]);
    expect(facePoint('north', hat, 1, 1)).toEqual([-4.5, 23.5, -4.5]);
  });

  it('south: u1 at from.x', () => {
    expect(facePoint('south', hat, 0, 0)).toEqual([-4.5, 32.5, 4.5]);
  });

  it('east: u1 at to.z', () => {
    expect(facePoint('east', hat, 0, 0)).toEqual([4.5, 32.5, 4.5]);
  });

  it('west: u1 at from.z', () => {
    expect(facePoint('west', hat, 0, 0)).toEqual([-4.5, 32.5, -4.5]);
  });

  it('up: u1 at from.x, v1 at from.z', () => {
    expect(facePoint('up', hat, 0, 0)).toEqual([-4.5, 32.5, -4.5]);
    expect(facePoint('up', hat, 1, 1)).toEqual([4.5, 32.5, 4.5]);
  });

  it('down: u1 at from.x, v1 at to.z', () => {
    expect(facePoint('down', hat, 0, 0)).toEqual([-4.5, 23.5, 4.5]);
  });
});

describe('voxelBounds', () => {
  const depth = 0.5;

  it('north voxels protrude from the raw front surface', () => {
    const b = voxelBounds('north', hat, 0, 1 / 8, 0, 1 / 8, depth);
    expect(b.from).toEqual([3.375, 31.375, -4.5]);
    expect(b.to).toEqual([4.5, 32.5, -4]);
  });

  it('south voxels protrude from the raw back surface', () => {
    const b = voxelBounds('south', hat, 0, 1 / 8, 0, 1 / 8, depth);
    expect(b.from).toEqual([-4.5, 31.375, 4]);
    expect(b.to).toEqual([-3.375, 32.5, 4.5]);
  });

  it('east voxels protrude from the raw +X surface', () => {
    const b = voxelBounds('east', hat, 0, 1 / 8, 0, 1 / 8, depth);
    expect(b.from).toEqual([4, 31.375, 3.375]);
    expect(b.to).toEqual([4.5, 32.5, 4.5]);
  });

  it('west voxels protrude from the raw -X surface', () => {
    const b = voxelBounds('west', hat, 0, 1 / 8, 0, 1 / 8, depth);
    expect(b.from).toEqual([-4.5, 31.375, -4.5]);
    expect(b.to).toEqual([-4, 32.5, -3.375]);
  });

  it('up voxels protrude from the raw top surface', () => {
    const b = voxelBounds('up', hat, 0, 1 / 8, 0, 1 / 8, depth);
    expect(b.from).toEqual([-4.5, 32, -4.5]);
    expect(b.to).toEqual([-3.375, 32.5, -3.375]);
  });

  it('down voxels protrude from the raw bottom surface', () => {
    const b = voxelBounds('down', hat, 7 / 8, 1, 7 / 8, 1, depth);
    expect(b.from).toEqual([3.375, 23.5, -4.5]);
    expect(b.to).toEqual([4.5, 24, -3.375]);
  });

  it('with depth = inflate the outer surface equals the inflated layer surface', () => {
    const b = voxelBounds('north', hat, 0, 1, 0, 1, 0.5);
    expect(b.from[2]).toBe(-4.5); // inflated front plane
    expect(b.to[2]).toBe(-4); // raw front plane
  });
});

describe('resolveDisabledFaces', () => {
  it('keeps only the textured outer face when the shell planes are owned (preserve_layer)', () => {
    // the six shell planes seal the layer, every side face would duplicate a
    // face another direction also produces in the edge/corner overlap volumes
    expect(resolveDisabledFaces('north', true)).toEqual(['east', 'south', 'west', 'up', 'down']);
    expect(resolveDisabledFaces('up', true)).toEqual(['north', 'east', 'south', 'west', 'down']);
  });

  it('keeps silhouette side faces when the depth separates the shells (pixel/fixed)', () => {
    expect(resolveDisabledFaces('north', false)).toEqual(['south']);
    expect(resolveDisabledFaces('west', false)).toEqual(['east']);
  });
});

describe('resolveDepth', () => {
  const texel = { u: 1.125, v: 1.125 };
  const options: GeneratorOptions = { ...DEFAULT_OPTIONS, fixedDepth: 0.4 };

  it('preserve_layer uses the layer inflate', () => {
    expect(resolveDepth('preserve_layer', 0.5, texel, options)).toBe(0.5);
  });

  it('preserve_layer falls back to the texel size when inflate is zero', () => {
    expect(resolveDepth('preserve_layer', 0, texel, options)).toBe(1.125);
  });

  it('pixel mode uses the mean texel edge', () => {
    expect(resolveDepth('pixel', 0.25, { u: 1, v: 0.5 }, options)).toBe(0.75);
  });

  it('fixed mode uses the configured depth', () => {
    expect(resolveDepth('fixed', 0.25, texel, options)).toBe(0.4);
  });

  it('never returns degenerate thickness', () => {
    expect(resolveDepth('fixed', 0.25, texel, { ...options, fixedDepth: 0 })).toBeGreaterThan(0);
  });
});
