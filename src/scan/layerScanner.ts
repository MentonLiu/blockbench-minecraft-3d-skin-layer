import { LAYER_NAME_RE } from '../domain/constants';

export interface CubeLike {
  name: string;
}

export function isLayerCubeName(name: string): boolean {
  return LAYER_NAME_RE.test(name);
}

/**
 * Finds `* Layer` cubes among the given cubes.
 *
 * Only cubes are ever considered - generated Groups share the layer's name, so
 * scanning all outliner nodes instead would make the plugin run twice.
 */
export function findLayerCubes<T extends CubeLike>(cubes: readonly T[]): T[] {
  const found: T[] = [];
  for (const cube of cubes) {
    if (isLayerCubeName(cube.name)) {
      found.push(cube);
    }
  }
  return found;
}
