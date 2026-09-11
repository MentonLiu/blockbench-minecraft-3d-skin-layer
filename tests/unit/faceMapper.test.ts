import { describe, expect, it } from 'vitest';
import { adjustedBox, faceSpans, insetBox, voxelBounds } from '../../src/geometry/faceMapper';
import type { Box } from '../../src/geometry/faceMapper';

// 参考模型的帽子层：8×8×8 立方体，inflate 0.5
// Hat layer of the reference model: 8x8x8 cube with inflate 0.5
const hatFrom: [number, number, number] = [-4, 24, -4];
const hatTo: [number, number, number] = [4, 32, 4];
const hat = adjustedBox(hatFrom, hatTo, 0.5, [1, 1, 1]);
const STANDOFF = 0.001;

function expectClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));
}

describe('adjustedBox', () => {
  it('expands by inflate on all axes', () => {
    expectClose(hat.from, [-4.5, 23.5, -4.5]);
    expectClose(hat.to, [4.5, 32.5, 4.5]);
  });

  it('applies stretch around the center', () => {
    const stretched = adjustedBox(hatFrom, hatTo, 0.5, [2, 1, 1]);
    expectClose(stretched.from, [-9, 23.5, -4.5]);
    expectClose(stretched.to, [9, 32.5, 4.5]);
  });
});

describe('insetBox', () => {
  it('shrinks a box by epsilon on every side', () => {
    const inset = insetBox(hat, 0.0015);
    expectClose(inset.from, [-4.4985, 23.5015, -4.4985]);
    expectClose(inset.to, [4.4985, 32.4985, 4.4985]);
  });
});

describe('faceSpans', () => {
  it('uses the given (inset) box', () => {
    expect(faceSpans('north', hat)).toEqual({ uSpan: 9, vSpan: 9 });
    expect(faceSpans('north', insetBox(hat, 0.0075))).toEqual({ uSpan: 8.985, vSpan: 8.985 });
  });
});

describe('voxelBounds', () => {
  // 每个方向的 epsilon：north 0、east .0015、south .003、west .0045、up .006、down .0075
  // 面盒子按 epsilon 平移（非内缩），单元格保持纹理像素尺寸
  // per-direction epsilon: north 0, east .0015, south .003, west .0045, up .006, down .0075
  // the face box is TRANSLATED by the epsilon, so cells stay texel-sized
  it('north voxels fill the inflate gap in front of the raw surface (north epsilon 0)', () => {
    const b = voxelBounds('north', hat, hatFrom, hatTo, 0, 1 / 8, 0, 1 / 8, STANDOFF, 0.5);
    expectClose(b.from, [3.375, 31.375, -4.501]);
    expectClose(b.to, [4.5, 32.5, -4.001]);
  });

  it('south voxels protrude from the raw back surface (south epsilon 0.003)', () => {
    const faceBox: Box = { from: [-4.497, 23.503, -4.497] as [number, number, number], to: [4.503, 32.503, 4.503] as [number, number, number] };
    const b = voxelBounds('south', faceBox, hatFrom, hatTo, 0, 1 / 8, 0, 1 / 8, STANDOFF, 0.503);
    expectClose(b.from, [-4.497, 31.378, 4.001]);
    expectClose(b.to, [-3.372, 32.503, 4.504]);
  });

  it('east voxels protrude from the raw +X surface (east epsilon 0.0015)', () => {
    const faceBox: Box = { from: [-4.4985, 23.5015, -4.4985] as [number, number, number], to: [4.5015, 32.5015, 4.5015] as [number, number, number] };
    const b = voxelBounds('east', faceBox, hatFrom, hatTo, 0, 1 / 8, 0, 1 / 8, STANDOFF, 0.5015);
    expectClose(b.from, [4.001, 31.3765, 3.3765]);
    expectClose(b.to, [4.5025, 32.5015, 4.5015]);
  });

  it('west voxels protrude from the raw -X surface (west epsilon 0.0045)', () => {
    const faceBox: Box = { from: [-4.4955, 23.5045, -4.4955] as [number, number, number], to: [4.5045, 32.5045, 4.5045] as [number, number, number] };
    const b = voxelBounds('west', faceBox, hatFrom, hatTo, 0, 1 / 8, 0, 1 / 8, STANDOFF, 0.5045);
    expectClose(b.from, [-4.5055, 31.3795, -4.4955]);
    expectClose(b.to, [-4.001, 32.5045, -3.3705]);
  });

  it('up voxels protrude from the raw top surface (up epsilon 0.006)', () => {
    const faceBox: Box = { from: [-4.494, 23.506, -4.494] as [number, number, number], to: [4.506, 32.506, 4.506] as [number, number, number] };
    const b = voxelBounds('up', faceBox, hatFrom, hatTo, 0, 1 / 8, 0, 1 / 8, STANDOFF, 0.506);
    expectClose(b.from, [-4.494, 32.001, -4.494]);
    expectClose(b.to, [-3.369, 32.507, -3.369]);
  });

  it('down voxels protrude from the raw bottom surface (down epsilon 0.0075)', () => {
    const faceBox: Box = { from: [-4.4925, 23.5075, -4.4925] as [number, number, number], to: [4.5075, 32.5075, 4.5075] as [number, number, number] };
    const b = voxelBounds('down', faceBox, hatFrom, hatTo, 7 / 8, 1, 7 / 8, 1, STANDOFF, 0.5075);
    expectClose(b.from, [3.3825, 23.4915, -4.4925]);
    expectClose(b.to, [4.5075, 23.999, -3.3675]);
  });
});
