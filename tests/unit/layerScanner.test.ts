import { describe, expect, it } from 'vitest';
import { findLayerCubes, isLayerCubeName } from '../../src/scan/layerScanner';

describe('layer name matching', () => {
  it('matches standard skin layer names', () => {
    expect(isLayerCubeName('Hat Layer')).toBe(true);
    expect(isLayerCubeName('Body Layer')).toBe(true);
    expect(isLayerCubeName('Right Arm Layer')).toBe(true);
    expect(isLayerCubeName('Left Leg Layer')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(isLayerCubeName('body layer')).toBe(true);
    expect(isLayerCubeName('HAT LAYER')).toBe(true);
  });

  it('matches digit-suffixed segment layers (jointed templates)', () => {
    expect(isLayerCubeName('Body Layer1')).toBe(true);
    expect(isLayerCubeName('Right Arm Layer2')).toBe(true);
    expect(isLayerCubeName('body layer12')).toBe(true);
  });

  it('rejects non-layer names', () => {
    expect(isLayerCubeName('MyLayer')).toBe(false);
    expect(isLayerCubeName('MyLayer1')).toBe(false);
    expect(isLayerCubeName('Layer Helper')).toBe(false);
    expect(isLayerCubeName('LayerExtra')).toBe(false);
    expect(isLayerCubeName('Layer')).toBe(false);
    expect(isLayerCubeName('Head')).toBe(false);
    expect(isLayerCubeName('Hat Layer Group')).toBe(false);
    expect(isLayerCubeName('Body Layer 1')).toBe(false);
  });
});

describe('findLayerCubes', () => {
  it('keeps only cubes whose name ends in Layer', () => {
    const cubes = [
      { name: 'Head', id: 1 },
      { name: 'Hat Layer', id: 2 },
      { name: 'Body', id: 3 },
      { name: 'Body Layer', id: 4 },
      { name: 'Hat Layer Group', id: 5 },
    ];
    expect(findLayerCubes(cubes)).toEqual([
      { name: 'Hat Layer', id: 2 },
      { name: 'Body Layer', id: 4 },
    ]);
  });

  it('returns an empty list for already converted models', () => {
    // 转换后大纲里只有名为 "Hat Layer" 的分组而没有立方体；
    // 模拟该状态（完全无立方体）时不应有任何匹配
    // after conversion the outliner holds a *Group* named "Hat Layer" and no cube;
    // simulating that state (no cubes at all) must produce no matches
    expect(findLayerCubes([])).toEqual([]);
    expect(findLayerCubes([{ name: 'px_north_0_0', id: 2 }])).toEqual([]);
  });
});
