import { LAYER_NAME_RE } from '../domain/constants';

export interface CubeLike {
  name: string;
}

/** 名称是否匹配 `* Layer` / Does the name match the `* Layer` pattern? */
export function isLayerCubeName(name: string): boolean {
  return LAYER_NAME_RE.test(name);
}

/**
 * 在给定的立方体中找出 `* Layer` 层立方体。
 * Finds `* Layer` cubes among the given cubes.
 *
 * 只扫描立方体本身——生成的分组与层同名，如果扫描全部大纲节点，
 * 插件就会被运行两次。
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
