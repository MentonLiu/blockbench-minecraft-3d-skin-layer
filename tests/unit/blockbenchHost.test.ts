import { describe, expect, it } from 'vitest';
import { adoptInitializedElement } from '../../src/blockbench/blockbenchHost';

describe('adoptInitializedElement', () => {
  it('removes the provisional root entry before attaching to a group', () => {
    const calls: string[] = [];
    const group = {} as Group;
    const element = {
      removeFromParent() { calls.push('remove'); },
      addTo(target?: Group | 'root') { calls.push(target === group ? 'group' : String(target)); },
    };

    adoptInitializedElement(element, group);

    expect(calls).toEqual(['remove', 'group']);
  });

  it('adds a root element exactly once after removing its provisional entry', () => {
    const calls: string[] = [];
    const element = {
      removeFromParent() { calls.push('remove'); },
      addTo(target?: Group | 'root') { calls.push(String(target)); },
    };

    adoptInitializedElement(element, null);

    expect(calls).toEqual(['remove', 'root']);
  });
});
