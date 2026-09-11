import { describe, expect, it } from 'vitest';
import { boxUvOffset, faceSpans, voxelBounds } from '../../src/geometry/faceMapper';

// Hat layer of the reference model: 8x8x8 cube
const hatFrom: [number, number, number] = [-4, 24, -4];
const hatTo: [number, number, number] = [4, 32, 4];
const hat = { from: hatFrom, to: hatTo };
const STANDOFF = 0.001;
const DEPTH = 1;

describe('faceSpans', () => {
  it('uses the raw box', () => {
    expect(faceSpans('north', hat)).toEqual({ uSpan: 8, vSpan: 8 });
    expect(faceSpans('east', hat)).toEqual({ uSpan: 8, vSpan: 8 });
    expect(faceSpans('up', hat)).toEqual({ uSpan: 8, vSpan: 8 });
  });
});

describe('facePoint conventions (via voxelBounds)', () => {
  it('north: u1 at to.x, v1 at to.y, slab off the raw front plane', () => {
    const b = voxelBounds('north', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    // first cell sits at the +X top corner
    expect(b.from).toEqual([3, 31, -4 - STANDOFF - DEPTH]);
    expect(b.to).toEqual([4, 32, -4 - STANDOFF]);
  });

  it('south: u1 at from.x, slab off the raw back plane', () => {
    const b = voxelBounds('south', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    expect(b.from).toEqual([-4, 31, 4 + STANDOFF]);
    expect(b.to).toEqual([-3, 32, 4 + STANDOFF + DEPTH]);
  });

  it('east: u1 at to.z, slab off the raw +X plane', () => {
    const b = voxelBounds('east', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    expect(b.from).toEqual([4 + STANDOFF, 31, 3]);
    expect(b.to).toEqual([4 + STANDOFF + DEPTH, 32, 4]);
  });

  it('west: u1 at from.z, slab off the raw -X plane', () => {
    const b = voxelBounds('west', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    expect(b.from).toEqual([-4 - STANDOFF - DEPTH, 31, -4]);
    expect(b.to).toEqual([-4 - STANDOFF, 32, -3]);
  });

  it('up: u1 at from.x, v1 at from.z, slab off the raw top plane', () => {
    const b = voxelBounds('up', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    expect(b.from).toEqual([-4, 32 + STANDOFF, -4]);
    expect(b.to).toEqual([-3, 32 + STANDOFF + DEPTH, -3]);
  });

  it('down: u1 at from.x, v1 at to.z, slab off the raw bottom plane', () => {
    const b = voxelBounds('down', hat, 7 / 8, 1, 7 / 8, 1, STANDOFF, DEPTH);
    expect(b.from).toEqual([3, 24 - STANDOFF - DEPTH, -4]);
    expect(b.to).toEqual([4, 24 - STANDOFF, -3]);
  });
});

describe('raw-extent grids never overlap between directions', () => {
  it('the north and west slabs of the hat are disjoint', () => {
    const north = voxelBounds('north', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    const west = voxelBounds('west', hat, 0, 1 / 8, 0, 1 / 8, STANDOFF, DEPTH);
    // north slab: x in [-4, 4]; west slab: x in [-5, -4]
    expect(north.from[0]).toBeGreaterThanOrEqual(-4);
    expect(west.to[0]).toBeLessThanOrEqual(-4);
    // west slab: z in [-4, 4]; north slab: z in [-5, -4]
    expect(west.from[2]).toBeGreaterThanOrEqual(-4);
    expect(north.to[2]).toBeLessThanOrEqual(-4);
  });
});

describe('boxUvOffset', () => {
  it('puts the north face rect on the source pixel', () => {
    // unit cube, pixel (40, 8): north rect = [ox+d, oy+d] -> offset (39, 7)
    expect(boxUvOffset('north', 40, 8, 1, 1)).toEqual([39, 7]);
  });

  it('handles every direction of a unit cube', () => {
    expect(boxUvOffset('south', 40, 8, 1, 1)).toEqual([37, 7]);
    expect(boxUvOffset('east', 40, 8, 1, 1)).toEqual([40, 7]);
    expect(boxUvOffset('west', 40, 8, 1, 1)).toEqual([38, 7]);
    expect(boxUvOffset('up', 40, 8, 1, 1)).toEqual([39, 8]);
    expect(boxUvOffset('down', 40, 8, 1, 1)).toEqual([38, 8]);
  });

  it('works in UV units for other texture scales', () => {
    // 128px texture with 64 UV space: texel = 0.5 UV units
    expect(boxUvOffset('north', 10, 10, 0.5, 0.5)).toEqual([9.5, 9.5]);
  });
});
