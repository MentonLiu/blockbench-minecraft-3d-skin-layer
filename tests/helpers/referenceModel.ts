import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { FaceDirection, LayerSnapshot, PixelSource, UVRect, Vec3 } from '../../src/domain/types';

export interface ReferenceModel {
  raw: {
    meta: unknown;
    elements: ReferenceElementJson[];
    outliner: unknown[];
    groups: ReferenceGroupJson[];
    textures: ReferenceTextureJson[];
  };
  texture: PixelSource;
  textures: Map<string, PixelSource>;
  textureKey: string;
  snapshots: LayerSnapshot[];
}

interface ReferenceElementJson {
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
  faces: Record<string, { uv: number[]; texture: number | string | false | null; rotation?: number }>;
}

interface ReferenceGroupJson {
  name: string;
  uuid: string;
  origin?: number[];
  rotation?: number[];
  visibility?: boolean;
}

interface ReferenceTextureJson {
  name: string;
  uuid: string;
  width: number;
  height: number;
  uv_width: number;
  uv_height: number;
  source: string;
}

function asVec3(values: number[] | undefined, fill: number): Vec3 {
  return [
    values?.[0] ?? fill,
    values?.[1] ?? fill,
    values?.[2] ?? fill,
  ];
}

/**
 * 加载参考皮肤模型：解析 .bbmodel JSON、解码内嵌纹理，并生成与插件
 * Blockbench 兼容层在运行时构建的相同的层快照。
 * Loads the provided reference skin model: parses the .bbmodel JSON, decodes
 * the embedded texture, and produces the same layer snapshots the plugin's
 * Blockbench compatibility layer would build at runtime.
 */
export function loadReferenceModel(): ReferenceModel {
  const raw = JSON.parse(
    readFileSync(new URL('../fixtures/skin_model.bbmodel', import.meta.url), 'utf8'),
  ) as ReferenceModel['raw'];

  const textureJson = raw.textures[0];
  const png = PNG.sync.read(
    Buffer.from(textureJson.source.slice(textureJson.source.indexOf(',') + 1), 'base64'),
  );
  const texture: PixelSource = {
    width: png.width,
    height: png.height,
    uvWidth: textureJson.uv_width,
    uvHeight: textureJson.uv_height,
    rgba: new Uint8ClampedArray(png.data),
  };
  const textures = new Map([[textureJson.uuid, texture]]);

  const snapshots: LayerSnapshot[] = raw.elements
    .filter(element => /\sLayer$/i.test(element.name))
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

  return { raw, texture, textures, textureKey: textureJson.uuid, snapshots };
}
