import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { FaceDirection, LayerSnapshot, PixelSource, UVRect, Vec3 } from '../../src/domain/types';
import { isLayerCubeName } from '../../src/scan/layerScanner';

export interface FixtureModel {
  raw: {
    meta: unknown;
    elements: FixtureElementJson[];
    outliner: unknown[];
    groups: FixtureGroupJson[];
    textures: FixtureTextureJson[];
  };
  /** 全部已解码纹理（uuid -> 像素快照）/ All decoded textures (uuid -> pixel source). */
  textures: Map<string, PixelSource>;
  textureKeys: string[];
  snapshots: LayerSnapshot[];
}

interface FixtureElementJson {
  name: string;
  type: 'cube';
  uuid: string;
  from: number[];
  to: number[];
  inflate?: number;
  stretch?: number[];
  origin?: number[];
  rotation?: number[];
  visibility?: boolean;
  box_uv?: boolean;
  uv_offset?: number[];
  faces: Record<string, { uv: number[]; texture: number | string | false | null; rotation?: number }>;
}

interface FixtureGroupJson {
  name?: string;
  uuid: string;
  origin?: number[];
  rotation?: number[];
  visibility?: boolean;
}

interface FixtureTextureJson {
  name: string;
  uuid: string;
  width: number;
  height: number;
  uv_width?: number;
  uv_height?: number;
  source: string;
}

function asVec3(values: number[] | undefined, fill: number): Vec3 {
  return [
    values?.[0] ?? fill,
    values?.[1] ?? fill,
    values?.[2] ?? fill,
  ];
}

function decodeTexture(textureJson: FixtureTextureJson): PixelSource {
  const png = PNG.sync.read(
    Buffer.from(textureJson.source.slice(textureJson.source.indexOf(',') + 1), 'base64'),
  );
  return {
    width: png.width,
    height: png.height,
    uvWidth: textureJson.uv_width ?? png.width,
    uvHeight: textureJson.uv_height ?? png.height,
    rgba: new Uint8ClampedArray(png.data),
  };
}

/**
 * 加载任一 bbmodel 夹具：解析 JSON、解码全部内嵌纹理，并生成与插件
 * Blockbench 兼容层在运行时构建的相同的层快照（含数字后缀层命名）。
 * Loads any .bbmodel fixture: parses the JSON, decodes every embedded texture,
 * and produces the same layer snapshots the plugin's Blockbench compatibility
 * layer would build at runtime (including digit-suffixed layer names).
 */
export function loadFixtureModel(filename: string): FixtureModel {
  const raw = JSON.parse(
    readFileSync(new URL(`../fixtures/${filename}`, import.meta.url), 'utf8'),
  ) as FixtureModel['raw'];

  const textures = new Map<string, PixelSource>();
  for (const textureJson of raw.textures) {
    textures.set(textureJson.uuid, decodeTexture(textureJson));
  }
  const textureKeys = raw.textures.map(textureJson => textureJson.uuid);

  const snapshots: LayerSnapshot[] = raw.elements
    .filter(element => isLayerCubeName(element.name))
    .map(element => ({
      key: element.uuid,
      name: element.name,
      from: asVec3(element.from, 0),
      to: asVec3(element.to, 0),
      inflate: element.inflate ?? 0,
      stretch: asVec3(element.stretch, 1),
      origin: asVec3(element.origin, 0),
      rotation: asVec3(element.rotation, 0),
      visibility: element.visibility !== false,
      faces: (['north', 'east', 'south', 'west', 'up', 'down'] as FaceDirection[])
        .filter(direction => element.faces[direction])
        .map(direction => {
          const face = element.faces[direction];
          const textureRef = face.texture;
          return {
            direction,
            enabled: textureRef !== null,
            textureKey:
              typeof textureRef === 'number'
                ? raw.textures[textureRef]?.uuid ?? null
                : typeof textureRef === 'string'
                  ? textureRef
                  : null,
            uv: [face.uv[0], face.uv[1], face.uv[2], face.uv[3]] as UVRect,
            rotation: ((Math.round((face.rotation ?? 0) / 90) * 90) % 360 + 360) % 360 as 0 | 90 | 180 | 270,
          };
        }),
    }));

  return { raw, textures, textureKeys, snapshots };
}

export interface ReferenceModel extends FixtureModel {
  texture: PixelSource;
  textureKey: string;
}

/**
 * 加载原始参考皮肤模型（64×64 steve64.png）。
 * Loads the original reference skin model (64x64 steve64.png).
 */
export function loadReferenceModel(): ReferenceModel {
  const model = loadFixtureModel('skin_model.bbmodel');
  const textureKey = model.textureKeys[0];
  return {
    ...model,
    textureKey,
    texture: model.textures.get(textureKey)!,
  };
}
