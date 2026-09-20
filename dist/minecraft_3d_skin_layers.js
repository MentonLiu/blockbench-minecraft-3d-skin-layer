"use strict";
(() => {
  // src/domain/constants.ts
  var PLUGIN_ID = "minecraft_3d_skin_layers";
  var GENERATED_SOURCE_PROPERTY = "m3sl_source";
  var LAYER_NAME_RE = /\sLayer\d*$/i;
  var FACE_DIRECTIONS = ["north", "east", "south", "west", "up", "down"];
  var DEFAULT_OPTIONS = {
    alphaThreshold: 0,
    maxVoxels: 1e4,
    batchSize: 200,
    preserveOriginal: false,
    replaceEmptyLayer: false,
    autoApplyOnLoad: false,
    processSelectedOnly: false,
    useUVToLocalWhenAvailable: false,
    targetModel: "current",
    includeTransparent: false
  };
  var VOXEL_STANDOFF = 1e-3;
  var FACE_EPSILON_STEP = 15e-4;
  var TEXEL_EPSILON = 0.01;

  // src/domain/types.ts
  var VoxelLimitError = class extends Error {
    constructor(voxelCount, limit) {
      super(`Voxel plan needs ${voxelCount} cubes which exceeds maxVoxels (${limit}).`);
      this.voxelCount = voxelCount;
      this.limit = limit;
      this.name = "VoxelLimitError";
    }
  };

  // src/geometry/faceMapper.ts
  function adjustedBox(from, to, inflate, stretch) {
    const inflatedFrom = [0, 0, 0];
    const inflatedTo = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const size = to[i] - from[i];
      const center = from[i] + size / 2;
      const half = (size / 2 + inflate) * stretch[i];
      inflatedFrom[i] = center - half;
      inflatedTo[i] = center + half;
    }
    return { from: inflatedFrom, to: inflatedTo };
  }
  function facePoint(direction, box, mx, my) {
    const f = box.from;
    const t2 = box.to;
    const lerp = (a, b, k) => a + (b - a) * k;
    switch (direction) {
      case "north":
        return [lerp(t2[0], f[0], mx), lerp(t2[1], f[1], my), f[2]];
      case "south":
        return [lerp(f[0], t2[0], mx), lerp(t2[1], f[1], my), t2[2]];
      case "east":
        return [t2[0], lerp(t2[1], f[1], my), lerp(t2[2], f[2], mx)];
      case "west":
        return [f[0], lerp(t2[1], f[1], my), lerp(f[2], t2[2], mx)];
      case "up":
        return [lerp(f[0], t2[0], mx), t2[1], lerp(f[2], t2[2], my)];
      case "down":
        return [lerp(f[0], t2[0], mx), f[1], lerp(t2[2], f[2], my)];
    }
  }
  function voxelBounds(direction, faceBox, rawFrom, rawTo, mx0, mx1, my0, my1, standoff, depth) {
    const a = facePoint(direction, faceBox, mx0, my0);
    const b = facePoint(direction, faceBox, mx1, my1);
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    const minZ = Math.min(a[2], b[2]);
    const maxZ = Math.max(a[2], b[2]);
    switch (direction) {
      case "north":
        return { from: [minX, minY, rawFrom[2] - standoff - depth], to: [maxX, maxY, rawFrom[2] - standoff] };
      case "south":
        return { from: [minX, minY, rawTo[2] + standoff], to: [maxX, maxY, rawTo[2] + standoff + depth] };
      case "east":
        return { from: [rawTo[0] + standoff, minY, minZ], to: [rawTo[0] + standoff + depth, maxY, maxZ] };
      case "west":
        return { from: [rawFrom[0] - standoff - depth, minY, minZ], to: [rawFrom[0] - standoff, maxY, maxZ] };
      case "up":
        return { from: [minX, rawTo[1] + standoff, minZ], to: [maxX, rawTo[1] + standoff + depth, maxZ] };
      case "down":
        return { from: [minX, rawFrom[1] - standoff - depth, minZ], to: [maxX, rawFrom[1] - standoff, maxZ] };
    }
  }

  // src/texture/pixelReader.ts
  function textureScales(texture) {
    const uvWidth = texture.uvWidth > 0 ? texture.uvWidth : texture.width;
    const uvHeight = texture.uvHeight > 0 ? texture.uvHeight : texture.height;
    return { sx: texture.width / uvWidth, sy: texture.height / uvHeight };
  }
  function getAlpha(texture, x, y) {
    const index = (y * texture.width + x) * 4;
    return texture.rgba[index + 3];
  }
  function faceGridSize(face, texture, warnings) {
    const { sx, sy } = textureScales(texture);
    const [u1, v1, u2, v2] = face.uv;
    const texelsU = Math.abs(u2 - u1) * sx;
    const texelsV = Math.abs(v2 - v1) * sy;
    const roundedU = Math.round(texelsU);
    const roundedV = Math.round(texelsV);
    const maxU = texture.width / sx;
    const maxV = texture.height / sy;
    if (Math.min(u1, u2) < 0 || Math.min(v1, v2) < 0 || Math.max(u1, u2) > maxU || Math.max(v1, v2) > maxV) {
      warnings.push(
        `${face.direction}: UV rect ${face.uv.join(", ")} exceeds the texture bounds, sampled area clamped`
      );
    }
    if (roundedU < 1 || roundedV < 1) {
      warnings.push(
        `${face.direction}: UV rect ${face.uv.join(", ")} spans no texels, face skipped`
      );
      return null;
    }
    if (Math.abs(texelsU - roundedU) > TEXEL_EPSILON || Math.abs(texelsV - roundedV) > TEXEL_EPSILON) {
      warnings.push(
        `${face.direction}: UV rect ${face.uv.join(", ")} spans non-integer texel counts (${texelsU} x ${texelsV}), face skipped`
      );
      return null;
    }
    const swapped = face.rotation === 90 || face.rotation === 270;
    return {
      cols: swapped ? roundedV : roundedU,
      rows: swapped ? roundedU : roundedV,
      texelsU: roundedU,
      texelsV: roundedV
    };
  }
  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }
  function sampleCell(face, uv, texture, sx, sy, grid, col, row) {
    const mx = (col + 0.5) / grid.cols;
    const my = (row + 0.5) / grid.rows;
    let pu;
    let pv;
    switch (face.rotation) {
      case 90:
        pu = my;
        pv = 1 - mx;
        break;
      case 180:
        pu = 1 - mx;
        pv = 1 - my;
        break;
      case 270:
        pu = 1 - my;
        pv = mx;
        break;
      default:
        pu = mx;
        pv = my;
    }
    let u = uv[0] + (uv[2] - uv[0]) * pu;
    let v = uv[1] + (uv[3] - uv[1]) * pv;
    const maxU = texture.width / sx;
    const maxV = texture.height / sy;
    if (u < 0 || u > maxU || v < 0 || v > maxV) {
      u = clamp(u, 0, Math.max(maxU - Number.EPSILON, 0));
      v = clamp(v, 0, Math.max(maxV - Number.EPSILON, 0));
    }
    const imageX = clamp(Math.floor(u * sx), 0, texture.width - 1);
    const imageY = clamp(Math.floor(v * sy), 0, texture.height - 1);
    const pixelUV = [
      imageX / sx,
      imageY / sy,
      (imageX + 1) / sx,
      (imageY + 1) / sy
    ];
    return { imageX, imageY, pixelUV };
  }
  function enumerateVisibleTexels(face, texture, alphaThreshold, includeTransparent = false) {
    const warnings = [];
    const grid = faceGridSize(face, texture, warnings);
    const cells = [];
    if (!grid) {
      return { cells, warnings };
    }
    const { sx, sy } = textureScales(texture);
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const sample = sampleCell(face, face.uv, texture, sx, sy, grid, col, row);
        const alpha = getAlpha(texture, sample.imageX, sample.imageY);
        if (includeTransparent || alpha > alphaThreshold) {
          cells.push({
            direction: face.direction,
            col,
            row,
            cols: grid.cols,
            rows: grid.rows,
            imageX: sample.imageX,
            imageY: sample.imageY,
            alpha,
            pixelUV: sample.pixelUV
          });
        }
      }
    }
    return { cells, warnings };
  }

  // src/geometry/voxelPlanner.ts
  function countPlanVoxels(plans) {
    return plans.reduce((sum, plan) => sum + plan.voxels.length, 0);
  }
  function directionEpsilon(direction) {
    return FACE_DIRECTIONS.indexOf(direction) * FACE_EPSILON_STEP;
  }
  function snapshotFace(layer, direction) {
    return layer.faces.find((face) => face.direction === direction);
  }
  function buildVoxelPlans(layers, textures, options) {
    const warnings = [];
    const plans = [];
    layers.forEach((layer) => {
      if (layer.to[0] <= layer.from[0] || layer.to[1] <= layer.from[1] || layer.to[2] <= layer.from[2]) {
        warnings.push(`${layer.name}: cube has non-positive size, skipped`);
        return;
      }
      const inflated = adjustedBox(layer.from, layer.to, layer.inflate, layer.stretch);
      const voxels = [];
      for (const direction of FACE_DIRECTIONS) {
        const face = snapshotFace(layer, direction);
        if (!face || !face.enabled) {
          continue;
        }
        const texture = face.textureKey !== null ? textures.get(face.textureKey) : void 0;
        if (!texture) {
          warnings.push(`${layer.name}/${direction}: face has no usable texture, face skipped`);
          continue;
        }
        const epsilon = directionEpsilon(direction);
        const faceBox = {
          from: [inflated.from[0] + epsilon, inflated.from[1] + epsilon, inflated.from[2] + epsilon],
          to: [inflated.to[0] + epsilon, inflated.to[1] + epsilon, inflated.to[2] + epsilon]
        };
        const scan = enumerateVisibleTexels(
          face,
          texture,
          options.alphaThreshold,
          options.includeTransparent
        );
        warnings.push(...scan.warnings.map((warning) => `${layer.name}/${warning}`));
        if (scan.cells.length === 0) {
          continue;
        }
        const depth = layer.inflate + epsilon;
        for (const cell of scan.cells) {
          const bounds = voxelBounds(
            direction,
            faceBox,
            layer.from,
            layer.to,
            cell.col / cell.cols,
            (cell.col + 1) / cell.cols,
            cell.row / cell.rows,
            (cell.row + 1) / cell.rows,
            VOXEL_STANDOFF,
            depth
          );
          const pixelUV = [
            cell.imageX / textureScales(texture).sx,
            cell.imageY / textureScales(texture).sy,
            (cell.imageX + 1) / textureScales(texture).sx,
            (cell.imageY + 1) / textureScales(texture).sy
          ];
          voxels.push({
            name: `px_${direction}_${cell.col}_${cell.row}`,
            from: bounds.from,
            to: bounds.to,
            origin: [...layer.origin],
            rotation: [...layer.rotation],
            textureKey: face.textureKey,
            pixelUV,
            face: direction
          });
        }
      }
      const isEmpty = voxels.length === 0;
      if (isEmpty && !options.replaceEmptyLayer) {
        return;
      }
      plans.push({
        sourceKey: layer.key,
        sourceName: layer.name,
        origin: [...layer.origin],
        voxels,
        visiblePixelCount: voxels.length,
        visibility: layer.visibility,
        source: layer
      });
    });
    return { plans, warnings };
  }

  // src/scan/layerScanner.ts
  function isLayerCubeName(name) {
    return LAYER_NAME_RE.test(name);
  }
  function findLayerCubes(cubes) {
    const found = [];
    for (const cube of cubes) {
      if (isLayerCubeName(cube.name)) {
        found.push(cube);
      }
    }
    return found;
  }

  // src/blockbench/compatibility.ts
  function asVec3(value, fill) {
    return [
      typeof value?.[0] === "number" ? value[0] : fill,
      typeof value?.[1] === "number" ? value[1] : fill,
      typeof value?.[2] === "number" ? value[2] : fill
    ];
  }
  function normalizeRotation(value) {
    const step = (Math.round((value ?? 0) / 90) * 90 % 360 + 360) % 360;
    return step === 90 || step === 180 || step === 270 ? step : 0;
  }
  function faceTextureKey(face) {
    const texture = face.texture;
    if (texture === null || texture === void 0 || texture === false) {
      return null;
    }
    if (typeof texture === "string") {
      return texture;
    }
    if (typeof texture === "object" && texture !== null && "uuid" in texture) {
      return String(texture.uuid);
    }
    return null;
  }
  function snapshotLayerCube(cube) {
    const faces = [];
    for (const direction of FACE_DIRECTIONS) {
      const face = cube.faces[direction];
      if (!face) {
        continue;
      }
      faces.push({
        direction,
        // texture === null 的面不参与渲染 / a face with texture === null does not exist for rendering
        enabled: face.texture !== null,
        textureKey: faceTextureKey(face),
        uv: [face.uv[0], face.uv[1], face.uv[2], face.uv[3]],
        rotation: normalizeRotation(face.rotation)
      });
    }
    return {
      key: cube.uuid,
      name: cube.name,
      from: asVec3(cube.from, 0),
      to: asVec3(cube.to, 0),
      inflate: typeof cube.inflate === "number" ? cube.inflate : 0,
      stretch: asVec3(cube.stretch, 1),
      origin: asVec3(cube.origin, 0),
      rotation: asVec3(cube.rotation, 0),
      visibility: cube.visibility !== false,
      boxUV: cube.box_uv,
      autouv: cube.autouv,
      mirrorUV: cube.mirror_uv,
      shade: cube.shade,
      color: typeof cube.color === "number" ? cube.color : void 0,
      rescale: cube.rescale,
      rotationAxis: cube.rotation_axis,
      uvOffset: Array.isArray(cube.uv_offset) ? [cube.uv_offset[0], cube.uv_offset[1]] : void 0,
      faces
    };
  }
  var VOXEL_NAME_RE = /^px_(north|east|south|west|up|down)_(\d+)_(\d+)$/i;
  function isCubeNode(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const node = value;
    return typeof node.name === "string" && typeof node.uuid === "string" && Array.isArray(node.from) && Array.isArray(node.to) && typeof node.faces === "object" && node.faces !== null;
  }
  function isGroupNode(value) {
    return Boolean(value && typeof value === "object" && Array.isArray(value.children));
  }
  function parseVoxelChild(value) {
    if (!isCubeNode(value)) {
      return void 0;
    }
    const match = VOXEL_NAME_RE.exec(value.name);
    if (!match) {
      return void 0;
    }
    return {
      cube: value,
      direction: match[1].toLowerCase(),
      col: Number(match[2]),
      row: Number(match[3])
    };
  }
  function readVec3(value, fallback) {
    return [
      typeof value?.[0] === "number" ? value[0] : fallback[0],
      typeof value?.[1] === "number" ? value[1] : fallback[1],
      typeof value?.[2] === "number" ? value[2] : fallback[2]
    ];
  }
  function isLayerSnapshot(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const source = value;
    return typeof source.key === "string" && typeof source.name === "string" && Array.isArray(source.from) && Array.isArray(source.to) && Array.isArray(source.faces);
  }
  function metadataSource(group) {
    const metadata = group[GENERATED_SOURCE_PROPERTY];
    return metadata?.schema === 1 && isLayerSnapshot(metadata.source) ? metadata.source : void 0;
  }
  function parentChildren(group) {
    const parent = group.parent;
    if (isGroupNode(parent)) {
      return parent.children;
    }
    return typeof Outliner === "object" && Array.isArray(Outliner.root) ? Outliner.root : [];
  }
  function findSiblingCube(group, names, hiddenOnly) {
    return parentChildren(group).find((node) => {
      if (!isCubeNode(node) || !names.includes(node.name)) {
        return false;
      }
      return !hiddenOnly || node.visibility === false;
    });
  }
  function baseNamesForLayer(name) {
    const match = /^(.*)\sLayer(\d*)$/i.exec(name);
    if (!match) {
      return [];
    }
    const base = match[1];
    const suffix = match[2];
    return suffix ? [`${base}${suffix}`, base] : [base];
  }
  function faceGridDimensions(direction, from, to) {
    const size = [Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), Math.abs(to[2] - from[2])];
    switch (direction) {
      case "north":
      case "south":
        return [Math.max(1, Math.round(size[0])), Math.max(1, Math.round(size[1]))];
      case "east":
      case "west":
        return [Math.max(1, Math.round(size[2])), Math.max(1, Math.round(size[1]))];
      case "up":
      case "down":
        return [Math.max(1, Math.round(size[0])), Math.max(1, Math.round(size[2]))];
    }
  }
  function inferFace(direction, entries, sourceFrom, sourceTo) {
    const samples = entries.map((entry) => {
      const face = entry.cube.faces[direction];
      if (!face || face.texture === null || face.texture === false || !Array.isArray(face.uv)) {
        return void 0;
      }
      return {
        col: entry.col,
        row: entry.row,
        centerU: (face.uv[0] + face.uv[2]) / 2,
        centerV: (face.uv[1] + face.uv[3]) / 2,
        pixelU: Math.abs(face.uv[2] - face.uv[0]),
        pixelV: Math.abs(face.uv[3] - face.uv[1]),
        textureKey: faceTextureKey(face)
      };
    }).filter((sample) => sample !== void 0);
    if (samples.length === 0 || samples[0].textureKey === null) {
      return void 0;
    }
    const [cols, rows] = faceGridDimensions(direction, sourceFrom, sourceTo);
    const pixelU = samples[0].pixelU || 1;
    const pixelV = samples[0].pixelV || 1;
    const first = samples[0];
    const candidates = [0, 90, 180, 270];
    let best;
    for (const rotation of candidates) {
      const swapped = rotation === 90 || rotation === 270;
      const spanU = pixelU * (swapped ? rows : cols);
      const spanV = pixelV * (swapped ? cols : rows);
      const parameter = (col, row) => {
        switch (rotation) {
          case 90:
            return [(row + 0.5) / rows, 1 - (col + 0.5) / cols];
          case 180:
            return [1 - (col + 0.5) / cols, 1 - (row + 0.5) / rows];
          case 270:
            return [1 - (row + 0.5) / rows, (col + 0.5) / cols];
          default:
            return [(col + 0.5) / cols, (row + 0.5) / rows];
        }
      };
      const [firstU, firstV] = parameter(first.col, first.row);
      const sourceU0 = first.centerU - firstU * spanU;
      const sourceV0 = first.centerV - firstV * spanV;
      const uv = [sourceU0, sourceV0, sourceU0 + spanU, sourceV0 + spanV];
      let error = 0;
      for (const sample of samples) {
        const [u, v] = parameter(sample.col, sample.row);
        error += Math.abs(sample.centerU - (sourceU0 + u * spanU));
        error += Math.abs(sample.centerV - (sourceV0 + v * spanV));
      }
      if (!best || error < best.error) {
        best = { rotation, uv, error };
      }
    }
    return {
      direction,
      enabled: true,
      textureKey: first.textureKey,
      uv: best.uv,
      rotation: best.rotation
    };
  }
  function inferLegacySource(group, children) {
    if (children.length === 0) {
      return void 0;
    }
    const baseCube = findSiblingCube(group, baseNamesForLayer(group.name), false);
    const base = baseCube ? snapshotLayerCube(baseCube) : void 0;
    const firstRotation = readVec3(children[0].cube.rotation, base?.rotation ?? [0, 0, 0]);
    const inflateSamples = children.map((child) => {
      const axis = child.direction === "north" || child.direction === "south" ? 2 : child.direction === "east" || child.direction === "west" ? 0 : 1;
      const thickness = Math.abs(child.cube.to[axis] - child.cube.from[axis]);
      return Math.max(0, thickness - FACE_DIRECTIONS.indexOf(child.direction) * FACE_EPSILON_STEP);
    });
    const inflate = inflateSamples.reduce((sum, value) => sum + value, 0) / inflateSamples.length;
    const sourceFrom = base?.from ? [...base.from] : [Infinity, Infinity, Infinity];
    const sourceTo = base?.to ? [...base.to] : [-Infinity, -Infinity, -Infinity];
    if (!base) {
      for (const child of children) {
        for (let axis = 0; axis < 3; axis++) {
          sourceFrom[axis] = Math.min(sourceFrom[axis], child.cube.from[axis]);
          sourceTo[axis] = Math.max(sourceTo[axis], child.cube.to[axis]);
        }
      }
      for (let axis = 0; axis < 3; axis++) {
        sourceFrom[axis] += inflate;
        sourceTo[axis] -= inflate;
      }
      for (const child of children) {
        switch (child.direction) {
          case "north":
            sourceFrom[2] = Math.min(sourceFrom[2], child.cube.to[2] + VOXEL_STANDOFF);
            break;
          case "south":
            sourceTo[2] = Math.max(sourceTo[2], child.cube.from[2] - VOXEL_STANDOFF);
            break;
          case "east":
            sourceTo[0] = Math.max(sourceTo[0], child.cube.from[0] - VOXEL_STANDOFF);
            break;
          case "west":
            sourceFrom[0] = Math.min(sourceFrom[0], child.cube.to[0] + VOXEL_STANDOFF);
            break;
          case "up":
            sourceTo[1] = Math.max(sourceTo[1], child.cube.from[1] - VOXEL_STANDOFF);
            break;
          case "down":
            sourceFrom[1] = Math.min(sourceFrom[1], child.cube.to[1] + VOXEL_STANDOFF);
            break;
        }
      }
    }
    const faces = FACE_DIRECTIONS.flatMap((direction) => {
      const entries = children.filter((child) => child.direction === direction);
      const face = inferFace(direction, entries, sourceFrom, sourceTo);
      return face ? [face] : [];
    });
    if (faces.length === 0) {
      return void 0;
    }
    return {
      key: group.uuid,
      name: group.name,
      from: sourceFrom,
      to: sourceTo,
      inflate,
      stretch: base?.stretch ?? [1, 1, 1],
      origin: base?.origin ?? readVec3(group.origin, [0, 0, 0]),
      rotation: base?.rotation ?? firstRotation,
      visibility: group.visibility !== false,
      boxUV: base?.boxUV,
      autouv: base?.autouv,
      mirrorUV: base?.mirrorUV,
      shade: base?.shade,
      color: base?.color,
      rescale: base?.rescale,
      rotationAxis: base?.rotationAxis,
      uvOffset: base?.uvOffset,
      faces
    };
  }
  function candidateForGroup(group) {
    const parsedChildren = group.children.map(parseVoxelChild);
    const children = parsedChildren.filter((child) => child !== void 0);
    const metadata = metadataSource(group);
    if (!metadata && (children.length === 0 || children.length !== group.children.length)) {
      return void 0;
    }
    const source = metadata ?? inferLegacySource(group, children);
    if (!source) {
      return void 0;
    }
    const existingSource = findSiblingCube(group, [group.name], true);
    return { group, children: children.map((child) => child.cube), source, existingSource };
  }
  function hasRestorableGroups() {
    return typeof Group !== "undefined" && Group.all.some((group) => {
      const node = group;
      return LAYER_NAME_RE.test(node.name) && Boolean(candidateForGroup(node));
    });
  }
  function collectRestoreCandidates() {
    if (typeof Group === "undefined") {
      return [];
    }
    return Group.all.flatMap((group) => {
      const node = group;
      if (!LAYER_NAME_RE.test(node.name)) {
        return [];
      }
      const candidate = candidateForGroup(node);
      return candidate ? [candidate] : [];
    });
  }
  function collectLayerSnapshots(options) {
    const cubes = findLayerCubes(Cube.all);
    const selected = options.processSelectedOnly ? cubes.filter((cube) => cube.selected === true) : cubes;
    return selected.map(snapshotLayerCube);
  }
  function resolveTextureByKey(key) {
    return Texture.all.find((texture) => texture.uuid === key);
  }
  function textureToPixelSource(texture) {
    const canvas = texture.canvas;
    if (!canvas) {
      throw new Error(`Texture "${texture.name}" has no canvas to read pixels from`);
    }
    const width = Math.max(1, Math.round(texture.width || canvas.width));
    const height = Math.max(1, Math.round(texture.height || canvas.height));
    const context = texture.ctx ?? canvas.getContext("2d");
    if (!context) {
      throw new Error(`Texture "${texture.name}" exposes no 2d context`);
    }
    const image = context.getImageData(0, 0, width, height);
    const uvWidth = typeof texture.getUVWidth === "function" ? texture.getUVWidth() : texture.uv_width ?? width;
    const uvHeight = typeof texture.getUVHeight === "function" ? texture.getUVHeight() : texture.uv_height ?? height;
    return {
      width,
      height,
      uvWidth: Math.max(1, uvWidth),
      uvHeight: Math.max(1, uvHeight),
      rgba: image.data
    };
  }
  function buildTextureMap(snapshots) {
    const warnings = [];
    const textures = /* @__PURE__ */ new Map();
    for (const snapshot of snapshots) {
      for (const face of snapshot.faces) {
        if (!face.enabled || face.textureKey === null || textures.has(face.textureKey)) {
          continue;
        }
        const texture = resolveTextureByKey(face.textureKey);
        if (!texture) {
          warnings.push(`${snapshot.name}: face texture ${face.textureKey} is not loaded`);
          continue;
        }
        try {
          textures.set(face.textureKey, textureToPixelSource(texture));
        } catch (error) {
          warnings.push(`${snapshot.name}: failed to read texture pixels (${String(error)})`);
        }
      }
    }
    return { textures, warnings };
  }
  function isEditMode() {
    return typeof Modes === "object" && Modes.edit === true;
  }
  function hasOpenProject() {
    return typeof Project !== "undefined" && !!Project;
  }
  function onProjectEvent(event, listener) {
    const handle = Blockbench.on(event, () => listener());
    return {
      dispose() {
        if (typeof handle?.delete === "function") {
          handle.delete();
        }
      }
    };
  }

  // src/blockbench/modelWriter.ts
  async function applyPlans(plans, options, host, resolveSource) {
    const voxelCount = countPlanVoxels(plans);
    if (voxelCount > options.maxVoxels) {
      throw new VoxelLimitError(voxelCount, options.maxVoxels);
    }
    if (plans.length === 0) {
      return { createdCubes: 0, createdGroups: 0, removedSources: 0 };
    }
    const sources = plans.map((plan) => resolveSource(plan.sourceKey));
    if (sources.some((source) => source === void 0)) {
      throw new Error("Layer cubes changed while planning; aborting generation");
    }
    host.beginUndo({ sources, groups: [] });
    const created = [];
    const groups = [];
    let removedSources = 0;
    let batch = 0;
    try {
      for (const plan of plans) {
        const source = resolveSource(plan.sourceKey);
        const parent = host.parentOf(source);
        const group = host.createGroup({
          name: plan.sourceName,
          origin: [...plan.origin],
          visibility: plan.visibility,
          restoreData: { schema: 1, source: plan.source }
        });
        host.initElement(group);
        host.adopt(group, parent);
        host.placeBefore(group, source);
        groups.push(group);
        for (const spec of plan.voxels) {
          const cube = host.createCube(spec);
          host.initElement(cube);
          host.adopt(cube, group);
          created.push(cube);
          batch++;
          if (batch >= options.batchSize) {
            batch = 0;
            await host.yieldToUI();
          }
        }
        if (options.preserveOriginal) {
          host.setVisibility(source, false);
        } else {
          host.remove(source);
          removedSources++;
        }
      }
      if (batch > 0) {
        await host.yieldToUI();
      }
      host.updateView(created, groups);
      host.finishUndo("Generate 3D skin layers", { created, groups });
      return { createdCubes: created.length, createdGroups: groups.length, removedSources };
    } catch (error) {
      host.cancelUndo(true);
      throw error;
    }
  }

  // src/blockbench/undoTransaction.ts
  var blockbenchUndo = {
    begin(aspects) {
      const elements = aspects.sources;
      Undo.initEdit({
        outliner: true,
        elements,
        groups: aspects.groups,
        selection: true
      });
    },
    finish(label, aspects) {
      Undo.finishEdit(label, {
        outliner: true,
        elements: aspects.created,
        groups: aspects.groups,
        selection: true
      });
    },
    cancel(revertChanges) {
      Undo.cancelEdit(revertChanges);
    }
  };

  // src/blockbench/blockbenchHost.ts
  function voxelFaces(spec) {
    const uv = [spec.pixelUV[0], spec.pixelUV[1], spec.pixelUV[2], spec.pixelUV[3]];
    const texture = resolveTextureByKey(spec.textureKey);
    const make = () => ({
      texture: texture ? texture.uuid : false,
      uv: [uv[0], uv[1], uv[2], uv[3]]
    });
    const faces = {};
    for (const direction of FACE_DIRECTIONS) {
      faces[direction] = make();
    }
    return faces;
  }
  function snapshotFaces(snapshot) {
    const faces = {};
    for (const face of snapshot.faces) {
      const texture = resolveTextureByKey(face.textureKey ?? "");
      faces[face.direction] = {
        texture: texture ? texture.uuid : false,
        uv: [...face.uv],
        rotation: face.rotation,
        enabled: face.enabled
      };
    }
    return faces;
  }
  var blockbenchHost = {
    beginUndo(aspects) {
      blockbenchUndo.begin(aspects);
    },
    finishUndo(label, aspects) {
      blockbenchUndo.finish(label, aspects);
    },
    cancelUndo(revertChanges) {
      blockbenchUndo.cancel(revertChanges);
    },
    createGroup(spec) {
      const group = new Group({
        name: spec.name,
        origin: [...spec.origin],
        visibility: spec.visibility
      });
      if (spec.restoreData) {
        group[GENERATED_SOURCE_PROPERTY] = spec.restoreData;
      }
      return group;
    },
    createCube(spec) {
      const cube = new Cube({
        name: spec.name,
        from: [...spec.from],
        to: [...spec.to],
        origin: [...spec.origin],
        rotation: [...spec.rotation],
        box_uv: false,
        autouv: 0,
        faces: voxelFaces(spec)
      });
      return cube;
    },
    createCubeFromSnapshot(snapshot) {
      const cube = new Cube({
        name: snapshot.name,
        from: [...snapshot.from],
        to: [...snapshot.to],
        origin: [...snapshot.origin],
        rotation: [...snapshot.rotation],
        stretch: [...snapshot.stretch ?? [1, 1, 1]],
        inflate: snapshot.inflate,
        visibility: snapshot.visibility,
        box_uv: snapshot.boxUV ?? false,
        autouv: snapshot.autouv ?? 0,
        mirror_uv: snapshot.mirrorUV ?? false,
        shade: snapshot.shade ?? true,
        color: snapshot.color,
        uv_offset: snapshot.uvOffset ? [...snapshot.uvOffset] : void 0,
        faces: snapshotFaces(snapshot)
      });
      if (snapshot.rescale !== void 0) {
        cube.rescale = snapshot.rescale;
      }
      if (snapshot.rotationAxis) {
        cube.rotation_axis = snapshot.rotationAxis;
      }
      return cube;
    },
    initElement(element) {
      element.init();
    },
    adopt(element, parent) {
      element.addTo(
        parent ?? void 0
      );
    },
    placeBefore(element, target) {
      element.sortInBefore(
        target,
        0
      );
    },
    parentOf(element) {
      return element.parent ?? null;
    },
    remove(element) {
      element.remove();
    },
    setVisibility(element, visible) {
      const node = element;
      node.visibility = visible;
    },
    updateView(created, groups) {
      Canvas.updateView({
        elements: created,
        element_aspects: {
          geometry: true,
          faces: true,
          uv: true,
          transform: true,
          visibility: true
        },
        groups,
        group_aspects: {
          transform: true,
          visibility: true
        }
      });
    },
    resolveTexture(key) {
      return resolveTextureByKey(key);
    },
    yieldToUI() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  // src/generate.ts
  function scanAndPlan(options) {
    const snapshots = collectLayerSnapshots(options);
    const { textures, warnings: textureWarnings } = buildTextureMap(snapshots);
    const { plans, warnings: planWarnings } = buildVoxelPlans(snapshots, textures, options);
    const warnings = [...textureWarnings, ...planWarnings];
    return { snapshots, plans, warnings, voxelCount: countPlanVoxels(plans) };
  }
  function resolveCubeByKey(key) {
    return Cube.all.find((cube) => cube.uuid === key);
  }
  async function applyOutcome(outcome, options) {
    const started = performance.now();
    const host = blockbenchHost;
    const summary = await applyPlans(
      outcome.plans,
      {
        maxVoxels: options.maxVoxels,
        batchSize: options.batchSize,
        preserveOriginal: options.preserveOriginal
      },
      host,
      (key) => resolveCubeByKey(key)
    );
    return {
      createdCubes: summary.createdCubes,
      createdGroups: summary.createdGroups,
      durationMs: performance.now() - started
    };
  }

  // src/i18n/strings.ts
  var en = {
    "m3sl.action.name": "Generate 3D Skin Layers",
    "m3sl.action.description": 'Replace "* Layer" cubes with per-pixel voxel cubes',
    "m3sl.restore_action.name": "Restore 3D Skin Layers",
    "m3sl.restore_action.description": "Convert generated 3D skin layer groups back to single cubes",
    "m3sl.format.name": "3D Skin Model",
    "m3sl.format.description": "Create a Minecraft skin model from a template: pick a template and a 64/128 texture, every pixel (transparent ones included) becomes a cube",
    "m3sl.menu.name": "3D Skin Model",
    "m3sl.wizard.title": "New 3D Skin Model",
    "m3sl.wizard.intro": "Choose a template model and a skin texture size. The template loads the matching texture and every pixel - transparent ones included - becomes a cube. Paint the skin, then use **3D Skin Model > Clear Transparent Cubes** to remove cubes at transparent pixels.",
    "m3sl.wizard.template": "Template model",
    "m3sl.wizard.template.classic": "Classic (original layout)",
    "m3sl.wizard.template.root": "Root-wrapped",
    "m3sl.wizard.template.joint": "Jointed segments",
    "m3sl.wizard.size": "Skin texture size",
    "m3sl.clear_action.name": "Clear Transparent Cubes",
    "m3sl.clear_action.description": "Remove voxel cubes whose sampled pixel is transparent",
    "m3sl.dialog.title": "Generate 3D Skin Layers",
    "m3sl.dialog.intro": "Found **%0** layer cube(s) with **%1** visible texel(s). Each texel becomes one cube with all six faces mapped to that pixel (thickness matches the original layer).",
    "m3sl.dialog.warnings_header": "Warnings:",
    "m3sl.dialog.warnings_more": "... %0 more",
    "m3sl.restore_dialog.title": "Restore 3D Skin Layers",
    "m3sl.restore_dialog.intro": "Found **%0** generated layer group(s) with **%1** voxel cube(s). Restoring recreates the original layer cubes and removes the generated groups.",
    "m3sl.form.use_new_project": "Use a new model project (copy the current model and modify the copy; the original stays untouched)",
    "m3sl.form.alpha_threshold": "Alpha threshold (texels with alpha above this become cubes)",
    "m3sl.form.max_voxels": "Maximum cube count (run aborts above this)",
    "m3sl.form.batch_size": "Cubes created per batch",
    "m3sl.form.preserve_original": "Keep original layer cubes (hide instead of delete)",
    "m3sl.form.replace_empty": "Replace fully transparent layers with empty groups",
    "m3sl.form.selected_only": "Only process selected layer cubes",
    "m3sl.form.auto_apply": "Generate automatically when a project loads",
    "m3sl.toast.generated": "Generated %0 cubes in %1 layer group(s) (%2s)",
    "m3sl.toast.warnings": "- %0 warning(s), see console",
    "m3sl.toast.no_layers": 'No "* Layer" cubes found - model left unchanged',
    "m3sl.toast.no_restorable_groups": "No generated 3D skin layer groups found - model left unchanged",
    "m3sl.toast.busy": "A generation run is already in progress",
    "m3sl.toast.limit": "Aborted: run needs %0 cubes, maxVoxels is %1. Raise the limit in the settings dialog if you really want this.",
    "m3sl.toast.edit_mode": "Switch to Edit mode to generate 3D skin layers",
    "m3sl.toast.open_project": "Open a project first",
    "m3sl.toast.failed": "Generation failed: %0",
    "m3sl.toast.restored": "Restored %0 layer cube(s) and removed %1 voxel cube(s)",
    "m3sl.toast.restore_failed": "Restore failed: %0",
    "m3sl.toast.edit_mode_restore": "Switch to Edit mode to restore 3D skin layers",
    "m3sl.toast.copied_note": "Changes were applied to a copied model; the original is untouched.",
    "m3sl.toast.cleared": "Removed %0 transparent voxel cube(s)",
    "m3sl.toast.no_transparent": "No transparent voxel cubes found",
    "m3sl.toast.wizard_created": "Created 3D skin model with %0 voxel cube(s) (%1s)",
    "m3sl.status.detected": '%0 skin layer cube(s) with %1 texels detected - use "Generate 3D Skin Layers" to voxelize'
  };
  var zh = {
    "m3sl.action.name": "\u751F\u6210 3D \u76AE\u80A4\u5C42",
    "m3sl.action.description": '\u5C06 "* Layer" \u7ACB\u65B9\u4F53\u66FF\u6362\u4E3A\u9010\u50CF\u7D20\u4F53\u7D20\u65B9\u5757',
    "m3sl.restore_action.name": "\u8FD8\u539F 3D \u76AE\u80A4\u5C42",
    "m3sl.restore_action.description": "\u5C06\u5DF2\u751F\u6210\u7684 3D \u76AE\u80A4\u5C42\u7EC4\u8FD8\u539F\u4E3A\u5355\u4E2A\u7ACB\u65B9\u4F53",
    "m3sl.format.name": "3D \u76AE\u80A4\u6A21\u578B",
    "m3sl.format.description": "\u4ECE\u6A21\u677F\u521B\u5EFA Minecraft \u76AE\u80A4\u6A21\u578B\uFF1A\u9009\u62E9\u6A21\u677F\u4E0E 64/128 \u7EB9\u7406\uFF0C\u6240\u6709\u50CF\u7D20\uFF08\u5305\u62EC\u900F\u660E\u50CF\u7D20\uFF09\u90FD\u4F1A\u751F\u6210\u65B9\u5757",
    "m3sl.menu.name": "3D \u76AE\u80A4\u6A21\u578B",
    "m3sl.wizard.title": "\u65B0\u5EFA 3D \u76AE\u80A4\u6A21\u578B",
    "m3sl.wizard.intro": "\u9009\u62E9\u6A21\u677F\u6A21\u578B\u4E0E\u76AE\u80A4\u7EB9\u7406\u5C3A\u5BF8\u3002\u6A21\u677F\u4F1A\u52A0\u8F7D\u5BF9\u5E94\u7684\u7EB9\u7406\uFF0C\u6240\u6709\u50CF\u7D20\u2014\u2014\u5305\u62EC\u900F\u660E\u50CF\u7D20\u2014\u2014\u90FD\u4F1A\u751F\u6210\u65B9\u5757\u3002\u7ED8\u5236\u76AE\u80A4\u540E\uFF0C\u4F7F\u7528 **3D \u76AE\u80A4\u6A21\u578B > \u6E05\u9664\u900F\u660E\u65B9\u5757** \u79FB\u9664\u900F\u660E\u50CF\u7D20\u5904\u7684\u65B9\u5757\u3002",
    "m3sl.wizard.template": "\u6A21\u677F\u6A21\u578B",
    "m3sl.wizard.template.classic": "\u7ECF\u5178\uFF08\u539F\u59CB\u5E03\u5C40\uFF09",
    "m3sl.wizard.template.root": "\u6839\u5206\u7EC4",
    "m3sl.wizard.template.joint": "\u5173\u8282\u5206\u6BB5",
    "m3sl.wizard.size": "\u76AE\u80A4\u7EB9\u7406\u5C3A\u5BF8",
    "m3sl.clear_action.name": "\u6E05\u9664\u900F\u660E\u65B9\u5757",
    "m3sl.clear_action.description": "\u5220\u9664\u91C7\u6837\u50CF\u7D20\u5DF2\u900F\u660E\u7684\u4F53\u7D20\u65B9\u5757",
    "m3sl.dialog.title": "\u751F\u6210 3D \u76AE\u80A4\u5C42",
    "m3sl.dialog.intro": "\u627E\u5230 **%0** \u4E2A\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53\uFF0C\u5171 **%1** \u4E2A\u53EF\u89C1\u50CF\u7D20\u3002\u6BCF\u4E2A\u50CF\u7D20\u4F1A\u751F\u6210\u4E00\u4E2A\u4F53\u7D20\u65B9\u5757\uFF0C\u516D\u4E2A\u9762\u90FD\u6620\u5C04\u5230\u8BE5\u50CF\u7D20\uFF08\u539A\u5EA6\u4E0E\u539F\u81A8\u80C0\u5C42\u4E00\u81F4\uFF09\u3002",
    "m3sl.dialog.warnings_header": "\u8B66\u544A\uFF1A",
    "m3sl.dialog.warnings_more": "\u2026\u2026\u53E6\u6709 %0 \u6761",
    "m3sl.restore_dialog.title": "\u8FD8\u539F 3D \u76AE\u80A4\u5C42",
    "m3sl.restore_dialog.intro": "\u627E\u5230 **%0** \u4E2A\u5DF2\u751F\u6210\u7684\u76AE\u80A4\u5C42\u5206\u7EC4\uFF08\u5171 **%1** \u4E2A\u4F53\u7D20\u65B9\u5757\uFF09\u3002\u8FD8\u539F\u4F1A\u91CD\u5EFA\u539F\u59CB\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53\uFF0C\u5E76\u5220\u9664\u751F\u6210\u7684\u5206\u7EC4\u3002",
    "m3sl.form.use_new_project": "\u4F7F\u7528\u65B0\u6A21\u578B\u9879\u76EE",
    "m3sl.form.alpha_threshold": "Alpha \u9608\u503C\uFF08Alpha \u9AD8\u4E8E\u8BE5\u503C\u7684\u50CF\u7D20\u4F1A\u751F\u6210\u65B9\u5757\uFF09",
    "m3sl.form.max_voxels": "\u6700\u5927\u65B9\u5757\u6570\u91CF\uFF08\u8D85\u8FC7\u6B64\u6570\u91CF\u5C06\u4E2D\u6B62\uFF09",
    "m3sl.form.batch_size": "\u6BCF\u6279\u521B\u5EFA\u7684\u65B9\u5757\u6570\u91CF",
    "m3sl.form.preserve_original": "\u4FDD\u7559\u539F\u59CB\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53\uFF08\u9690\u85CF\u800C\u975E\u5220\u9664\uFF09",
    "m3sl.form.replace_empty": "\u7528\u7A7A\u7EC4\u66FF\u6362\u5B8C\u5168\u900F\u660E\u7684\u76AE\u80A4\u5C42",
    "m3sl.form.selected_only": "\u4EC5\u5904\u7406\u9009\u4E2D\u7684\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53",
    "m3sl.form.auto_apply": "\u6253\u5F00\u9879\u76EE\u65F6\u81EA\u52A8\u751F\u6210",
    "m3sl.toast.generated": "\u5DF2\u751F\u6210 %0 \u4E2A\u65B9\u5757\uFF08%1 \u4E2A\u76AE\u80A4\u5C42\u7EC4\uFF09\uFF0C\u8017\u65F6 %2 \u79D2",
    "m3sl.toast.warnings": "- %0 \u6761\u8B66\u544A\uFF0C\u8BE6\u89C1\u63A7\u5236\u53F0",
    "m3sl.toast.no_layers": '\u672A\u627E\u5230 "* Layer" \u7ACB\u65B9\u4F53 \u2014\u2014 \u6A21\u578B\u672A\u505A\u4EFB\u4F55\u4FEE\u6539',
    "m3sl.toast.no_restorable_groups": "\u672A\u627E\u5230\u53EF\u8FD8\u539F\u7684 3D \u76AE\u80A4\u5C42\u7EC4 \u2014\u2014 \u6A21\u578B\u672A\u505A\u4EFB\u4F55\u4FEE\u6539",
    "m3sl.toast.busy": "\u5DF2\u6709\u4E00\u6B21\u751F\u6210\u6B63\u5728\u8FDB\u884C\u4E2D",
    "m3sl.toast.limit": "\u5DF2\u4E2D\u6B62\uFF1A\u672C\u6B21\u9700\u8981 %0 \u4E2A\u65B9\u5757\uFF0C\u8D85\u51FA\u4E0A\u9650 %1\u3002\u5982\u786E\u6709\u9700\u8981\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u5BF9\u8BDD\u6846\u4E2D\u8C03\u9AD8\u4E0A\u9650\u3002",
    "m3sl.toast.edit_mode": "\u8BF7\u5148\u5207\u6362\u5230\u7F16\u8F91\u6A21\u5F0F\u518D\u751F\u6210 3D \u76AE\u80A4\u5C42",
    "m3sl.toast.open_project": "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u9879\u76EE",
    "m3sl.toast.failed": "\u751F\u6210\u5931\u8D25\uFF1A%0",
    "m3sl.toast.restored": "\u5DF2\u8FD8\u539F %0 \u4E2A\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53\uFF0C\u5E76\u79FB\u9664 %1 \u4E2A\u4F53\u7D20\u65B9\u5757",
    "m3sl.toast.restore_failed": "\u8FD8\u539F\u5931\u8D25\uFF1A%0",
    "m3sl.toast.edit_mode_restore": "\u8BF7\u5148\u5207\u6362\u5230\u7F16\u8F91\u6A21\u5F0F\u518D\u8FD8\u539F 3D \u76AE\u80A4\u5C42",
    "m3sl.toast.copied_note": "\u4FEE\u6539\u5DF2\u5E94\u7528\u5230\u590D\u5236\u51FA\u7684\u65B0\u6A21\u578B\uFF0C\u539F\u6A21\u578B\u4FDD\u6301\u4E0D\u53D8\u3002",
    "m3sl.toast.cleared": "\u5DF2\u6E05\u9664 %0 \u4E2A\u900F\u660E\u4F53\u7D20\u65B9\u5757",
    "m3sl.toast.no_transparent": "\u6CA1\u6709\u9700\u8981\u6E05\u9664\u7684\u900F\u660E\u4F53\u7D20\u65B9\u5757",
    "m3sl.toast.wizard_created": "\u5DF2\u521B\u5EFA 3D \u76AE\u80A4\u6A21\u578B\uFF08%0 \u4E2A\u4F53\u7D20\u65B9\u5757\uFF0C\u8017\u65F6 %1 \u79D2\uFF09",
    "m3sl.status.detected": '\u68C0\u6D4B\u5230 %0 \u4E2A\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53\uFF08%1 \u4E2A\u50CF\u7D20\uFF09\u2014\u2014 \u4F7F\u7528"\u751F\u6210 3D \u76AE\u80A4\u5C42"\u8FDB\u884C\u4F53\u7D20\u5316'
  };

  // src/i18n/index.ts
  var registered = false;
  function registerTranslations() {
    if (registered) {
      return;
    }
    Language.addTranslations("en", en);
    Language.addTranslations("zh", zh);
    registered = true;
  }
  function t(key, variables) {
    const fallback = en[key];
    return tl(key, variables && variables.length ? variables : void 0, fallback);
  }

  // src/blockbench/modelRestorer.ts
  function applyRestores(candidates, host) {
    if (candidates.length === 0) {
      return { restoredCubes: 0, restoredGroups: 0, removedVoxels: 0 };
    }
    const groups = candidates.map((candidate) => candidate.group);
    const children = candidates.flatMap((candidate) => [...candidate.children]);
    host.beginUndo({ sources: children, groups });
    const restored = [];
    let removedVoxels = 0;
    try {
      for (const candidate of candidates) {
        const parent = host.parentOf(candidate.group);
        if (candidate.existingSource !== void 0) {
          host.setVisibility(candidate.existingSource, candidate.source.visibility);
        } else {
          const cube = host.createCubeFromSnapshot(candidate.source);
          host.initElement(cube);
          host.adopt(cube, parent);
          host.placeBefore(cube, candidate.group);
          restored.push(cube);
        }
        removedVoxels += candidate.children.length;
        host.remove(candidate.group);
      }
      host.updateView(restored, []);
      host.finishUndo("Restore 3D skin layers", { created: restored, groups: [] });
      return {
        restoredCubes: candidates.length,
        restoredGroups: candidates.length,
        removedVoxels
      };
    } catch (error) {
      host.cancelUndo(true);
      throw error;
    }
  }

  // src/blockbench/projectDuplicate.ts
  var blockbenchDuplicateHost = {
    activeProjectName() {
      return Project.name;
    },
    compileSnapshot() {
      return Codecs.project.compile({ raw: true, bitmaps: true });
    },
    setupCopyProject() {
      setupProject(Project.format);
    },
    loadSnapshot(model) {
      const parse = Codecs.project.parse;
      if (typeof parse !== "function") {
        throw new Error("Blockbench project codec cannot parse models");
      }
      parse.call(Codecs.project, model, "");
    },
    setProjectName(name) {
      Project.name = name;
    }
  };
  var autoScanSuppressed = false;
  function isAutoScanSuppressed() {
    return autoScanSuppressed;
  }
  function suppressAutoScanDuring(fn) {
    autoScanSuppressed = true;
    try {
      return fn();
    } finally {
      autoScanSuppressed = false;
    }
  }
  function duplicateCurrentProjectAsCopy(host = blockbenchDuplicateHost, suffix = " - Copy") {
    const originalName = host.activeProjectName();
    const model = host.compileSnapshot();
    suppressAutoScanDuring(() => {
      host.setupCopyProject();
      host.loadSnapshot(model);
    });
    if (originalName) {
      host.setProjectName(originalName + suffix);
    }
  }

  // src/blockbench/transparentCleaner.ts
  function isSingleTexelUV(pixelUV, texture) {
    const { sx, sy } = textureScales(texture);
    const width = Math.abs(pixelUV[2] - pixelUV[0]) * sx;
    const height = Math.abs(pixelUV[3] - pixelUV[1]) * sy;
    return Math.abs(width - 1) < 0.01 && Math.abs(height - 1) < 0.01;
  }
  function planTransparentRemovals(items, textures, alphaThreshold) {
    const warnings = [];
    const removable = [];
    let keptCount = 0;
    for (const item of items) {
      const texture = item.textureKey !== null ? textures.get(item.textureKey) : void 0;
      if (!texture) {
        warnings.push(`${item.name}: texture not readable, cube kept`);
        keptCount++;
        continue;
      }
      if (!isSingleTexelUV(item.pixelUV, texture)) {
        warnings.push(`${item.name}: face UV is not a single texel, cube kept`);
        keptCount++;
        continue;
      }
      const { sx, sy } = textureScales(texture);
      const x = Math.round(item.pixelUV[0] * sx);
      const y = Math.round(item.pixelUV[1] * sy);
      if (x < 0 || y < 0 || x >= texture.width || y >= texture.height) {
        warnings.push(`${item.name}: sample (${x}, ${y}) is outside the texture, cube kept`);
        keptCount++;
        continue;
      }
      const alpha = getAlpha(texture, x, y);
      if (alpha <= alphaThreshold) {
        removable.push(item);
      } else {
        keptCount++;
      }
    }
    return { removable, keptCount, warnings };
  }
  function collectVoxelPixelRefs() {
    if (typeof Group === "undefined") {
      return [];
    }
    const refs = [];
    const groups = Group.all.filter((group) => {
      const metadata = group[GENERATED_SOURCE_PROPERTY];
      return metadata !== null && metadata !== void 0;
    });
    for (const group of groups) {
      for (const child of group.children) {
        const cube = child;
        if (!cube || !cube.faces || cube.type !== "cube") {
          continue;
        }
        const face = cube.faces.north ?? cube.faces.south ?? cube.faces.east ?? cube.faces.west;
        if (!face || face.texture === null) {
          continue;
        }
        const uv = face.uv;
        refs.push({
          cube,
          name: cube.name,
          pixelUV: [uv[0], uv[1], uv[2], uv[3]],
          textureKey: faceTextureKey(face)
        });
      }
    }
    return refs;
  }
  function decodeReferencedTextures(items) {
    const textures = /* @__PURE__ */ new Map();
    const warnings = [];
    for (const item of items) {
      if (item.textureKey === null || textures.has(item.textureKey)) {
        continue;
      }
      const texture = resolveTextureByKey(item.textureKey);
      if (!texture) {
        warnings.push(`texture ${item.textureKey} is not loaded`);
        continue;
      }
      try {
        textures.set(item.textureKey, textureToPixelSource(texture));
      } catch (error) {
        warnings.push(`failed to read texture pixels (${String(error)})`);
      }
    }
    return { textures, warnings };
  }
  function clearTransparentCubes(host, alphaThreshold) {
    const refs = collectVoxelPixelRefs();
    if (refs.length === 0) {
      return { removed: 0, warnings: [] };
    }
    const { textures, warnings: decodeWarnings } = decodeReferencedTextures(refs);
    const plan = planTransparentRemovals(refs, textures, alphaThreshold);
    const warnings = [...decodeWarnings, ...plan.warnings];
    if (plan.removable.length === 0) {
      return { removed: 0, warnings };
    }
    host.beginUndo({ sources: plan.removable.map((item) => item.cube), groups: [] });
    try {
      for (const item of plan.removable) {
        host.remove(item.cube);
      }
      host.finishUndo("Clear transparent cubes", { created: [], groups: [] });
      return { removed: plan.removable.length, warnings };
    } catch (error) {
      host.cancelUndo(true);
      throw error;
    }
  }

  // src/ui/settingsDialog.ts
  var STORAGE_KEY = `${PLUGIN_ID}.options`;
  function toNumber(value, fallback, min, max) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }
  function toBool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }
  function toTargetModel(value, fallback) {
    return value === "copy" || value === "current" ? value : fallback;
  }
  function sanitizeOptions(raw) {
    const source = typeof raw === "object" && raw !== null ? raw : {};
    return {
      alphaThreshold: Math.round(toNumber(source.alphaThreshold, DEFAULT_OPTIONS.alphaThreshold, 0, 255)),
      maxVoxels: Math.round(toNumber(source.maxVoxels, DEFAULT_OPTIONS.maxVoxels, 1, 1e6)),
      batchSize: Math.round(toNumber(source.batchSize, DEFAULT_OPTIONS.batchSize, 10, 5e3)),
      preserveOriginal: toBool(source.preserveOriginal, DEFAULT_OPTIONS.preserveOriginal),
      replaceEmptyLayer: toBool(source.replaceEmptyLayer, DEFAULT_OPTIONS.replaceEmptyLayer),
      autoApplyOnLoad: toBool(source.autoApplyOnLoad, DEFAULT_OPTIONS.autoApplyOnLoad),
      processSelectedOnly: toBool(source.processSelectedOnly, DEFAULT_OPTIONS.processSelectedOnly),
      useUVToLocalWhenAvailable: toBool(
        source.useUVToLocalWhenAvailable,
        DEFAULT_OPTIONS.useUVToLocalWhenAvailable
      ),
      targetModel: toTargetModel(source.targetModel, DEFAULT_OPTIONS.targetModel),
      includeTransparent: toBool(source.includeTransparent, DEFAULT_OPTIONS.includeTransparent)
    };
  }
  function loadOptions() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return { ...DEFAULT_OPTIONS };
      }
      return sanitizeOptions(JSON.parse(stored));
    } catch {
      return { ...DEFAULT_OPTIONS };
    }
  }
  function persistOptions(options) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch {
    }
  }
  function showGenerationDialog(summary, options, onConfirm, onCancel) {
    const warningText = summary.warnings.length ? `

${t("m3sl.dialog.warnings_header")}
- ${summary.warnings.slice(0, 5).join("\n- ")}` + (summary.warnings.length > 5 ? `
- ${t("m3sl.dialog.warnings_more", [summary.warnings.length - 5])}` : "") : "";
    new Dialog({
      id: `${PLUGIN_ID}.generate_dialog`,
      title: t("m3sl.dialog.title"),
      width: 512,
      form: {
        intro: {
          type: "info",
          text: t("m3sl.dialog.intro", [summary.layerCount, summary.voxelCount]) + warningText
        },
        alphaThreshold: {
          label: t("m3sl.form.alpha_threshold"),
          type: "number",
          value: options.alphaThreshold,
          min: 0,
          max: 255,
          step: 1,
          force_step: true
        },
        maxVoxels: {
          label: t("m3sl.form.max_voxels"),
          type: "number",
          value: options.maxVoxels,
          min: 1,
          max: 1e6,
          step: 100,
          force_step: true
        },
        batchSize: {
          label: t("m3sl.form.batch_size"),
          type: "number",
          value: options.batchSize,
          min: 10,
          max: 5e3,
          step: 10,
          force_step: true
        },
        preserveOriginal: {
          label: t("m3sl.form.preserve_original"),
          type: "checkbox",
          value: options.preserveOriginal
        },
        replaceEmptyLayer: {
          label: t("m3sl.form.replace_empty"),
          type: "checkbox",
          value: options.replaceEmptyLayer
        },
        processSelectedOnly: {
          label: t("m3sl.form.selected_only"),
          type: "checkbox",
          value: options.processSelectedOnly
        },
        autoApplyOnLoad: {
          label: t("m3sl.form.auto_apply"),
          type: "checkbox",
          value: options.autoApplyOnLoad
        },
        useNewProject: {
          label: t("m3sl.form.use_new_project"),
          type: "checkbox",
          value: options.targetModel === "copy"
        }
      },
      onConfirm(formResult) {
        const raw = { ...options, ...formResult };
        raw.targetModel = formResult.useNewProject === true ? "copy" : "current";
        onConfirm(sanitizeOptions(raw));
      },
      onClose() {
        onCancel();
      }
    }).show();
  }

  // src/ui/restoreDialog.ts
  function showRestoreDialog(summary, options, onConfirm, onCancel) {
    new Dialog({
      id: `${PLUGIN_ID}.restore_dialog`,
      title: t("m3sl.restore_dialog.title"),
      width: 512,
      form: {
        intro: {
          type: "info",
          text: t("m3sl.restore_dialog.intro", [summary.groupCount, summary.voxelCount])
        },
        useNewProject: {
          label: t("m3sl.form.use_new_project"),
          type: "checkbox",
          value: options.targetModel === "copy"
        }
      },
      onConfirm(formResult) {
        const raw = { ...options, ...formResult };
        raw.targetModel = formResult.useNewProject === true ? "copy" : "current";
        onConfirm(sanitizeOptions(raw));
      },
      onClose() {
        onCancel();
      }
    }).show();
  }

  // src/assets/embedded.ts
  var NEW_SKIN_FORMAT_ID = "m3sl_3d_skin";
  var EMBEDDED_TEMPLATES = {
    "classic": { "meta": { "format_version": "5.0", "model_format": "m3sl_3d_skin", "box_uv": true }, "name": "skins_model", "model_identifier": "skins_model", "visible_box": [1, 1, 0], "variable_placeholders": "", "multi_file_ruleset": "", "variable_placeholder_buttons": [], "timeline_setups": [], "unhandled_root_fields": {}, "resolution": { "width": 64, "height": 64 }, "elements": [{ "name": "Head", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 24, -4], "to": [4, 32, 4], "autouv": 0, "color": 0, "origin": [0, 0, 0], "faces": { "north": { "uv": [8, 8, 16, 16], "texture": 0 }, "east": { "uv": [0, 8, 8, 16], "texture": 0 }, "south": { "uv": [24, 8, 32, 16], "texture": 0 }, "west": { "uv": [16, 8, 24, 16], "texture": 0 }, "up": { "uv": [16, 8, 8, 0], "texture": 0 }, "down": { "uv": [24, 0, 16, 8], "texture": 0 } }, "type": "cube", "uuid": "dcd7e8b4-f58c-cc99-2da3-b12ec0f84e26" }, { "name": "Hat Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 24, -4], "to": [4, 32, 4], "autouv": 0, "color": 0, "inflate": 0.5, "origin": [0, 0, 0], "uv_offset": [32, 0], "faces": { "north": { "uv": [40, 8, 48, 16], "texture": 0 }, "east": { "uv": [32, 8, 40, 16], "texture": 0 }, "south": { "uv": [56, 8, 64, 16], "texture": 0 }, "west": { "uv": [48, 8, 56, 16], "texture": 0 }, "up": { "uv": [48, 8, 40, 0], "texture": 0 }, "down": { "uv": [56, 0, 48, 8], "texture": 0 } }, "type": "cube", "uuid": "e7eba86e-ea3e-ba2b-83ed-234f05cb4e5a" }, { "name": "Body", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [16, 16], "faces": { "north": { "uv": [20, 20, 28, 32], "texture": 0 }, "east": { "uv": [16, 20, 20, 32], "texture": 0 }, "south": { "uv": [32, 20, 40, 32], "texture": 0 }, "west": { "uv": [28, 20, 32, 32], "texture": 0 }, "up": { "uv": [28, 20, 20, 16], "texture": 0 }, "down": { "uv": [36, 16, 28, 20], "texture": 0 } }, "type": "cube", "uuid": "f8dedc1b-c1fa-41d8-b626-a8277bcc34cb" }, { "name": "Body Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [16, 32], "faces": { "north": { "uv": [20, 36, 28, 48], "texture": 0 }, "east": { "uv": [16, 36, 20, 48], "texture": 0 }, "south": { "uv": [32, 36, 40, 48], "texture": 0 }, "west": { "uv": [28, 36, 32, 48], "texture": 0 }, "up": { "uv": [28, 36, 20, 32], "texture": 0 }, "down": { "uv": [36, 32, 28, 36], "texture": 0 } }, "type": "cube", "uuid": "28198e2f-03f4-2693-6abc-38aa0ea27713" }, { "name": "Right Arm", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 12, -2], "to": [8, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [40, 16], "faces": { "north": { "uv": [44, 20, 48, 32], "texture": 0 }, "east": { "uv": [40, 20, 44, 32], "texture": 0 }, "south": { "uv": [52, 20, 56, 32], "texture": 0 }, "west": { "uv": [48, 20, 52, 32], "texture": 0 }, "up": { "uv": [48, 20, 44, 16], "texture": 0 }, "down": { "uv": [52, 16, 48, 20], "texture": 0 } }, "type": "cube", "uuid": "40941e09-3206-f7a6-276e-71da0d22d66a" }, { "name": "Right Arm Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 12, -2], "to": [8, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [40, 32], "faces": { "north": { "uv": [44, 36, 48, 48], "texture": 0 }, "east": { "uv": [40, 36, 44, 48], "texture": 0 }, "south": { "uv": [52, 36, 56, 48], "texture": 0 }, "west": { "uv": [48, 36, 52, 48], "texture": 0 }, "up": { "uv": [48, 36, 44, 32], "texture": 0 }, "down": { "uv": [52, 32, 48, 36], "texture": 0 } }, "type": "cube", "uuid": "3d4cdef6-a626-a1c6-1d10-019ca9668f23" }, { "name": "Left Arm", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 12, -2], "to": [-4, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [32, 48], "faces": { "north": { "uv": [36, 52, 40, 64], "texture": 0 }, "east": { "uv": [32, 52, 36, 64], "texture": 0 }, "south": { "uv": [44, 52, 48, 64], "texture": 0 }, "west": { "uv": [40, 52, 44, 64], "texture": 0 }, "up": { "uv": [40, 52, 36, 48], "texture": 0 }, "down": { "uv": [44, 48, 40, 52], "texture": 0 } }, "type": "cube", "uuid": "36c7f60a-6539-aba5-b1f3-5b30e1c41296" }, { "name": "Left Arm Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 12, -2], "to": [-4, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [48, 48], "faces": { "north": { "uv": [52, 52, 56, 64], "texture": 0 }, "east": { "uv": [48, 52, 52, 64], "texture": 0 }, "south": { "uv": [60, 52, 64, 64], "texture": 0 }, "west": { "uv": [56, 52, 60, 64], "texture": 0 }, "up": { "uv": [56, 52, 52, 48], "texture": 0 }, "down": { "uv": [60, 48, 56, 52], "texture": 0 } }, "type": "cube", "uuid": "031606c4-21ce-ab2b-3816-04fa634a0aff" }, { "name": "Right Leg", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 0, -2], "to": [3.9, 12, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [0, 16], "faces": { "north": { "uv": [4, 20, 8, 32], "texture": 0 }, "east": { "uv": [0, 20, 4, 32], "texture": 0 }, "south": { "uv": [12, 20, 16, 32], "texture": 0 }, "west": { "uv": [8, 20, 12, 32], "texture": 0 }, "up": { "uv": [8, 20, 4, 16], "texture": 0 }, "down": { "uv": [12, 16, 8, 20], "texture": 0 } }, "type": "cube", "uuid": "1cf9b045-7021-1d51-a272-f449bb18e430" }, { "name": "Right Leg Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 0, -2], "to": [3.9, 12, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 32], "faces": { "north": { "uv": [4, 36, 8, 48], "texture": 0 }, "east": { "uv": [0, 36, 4, 48], "texture": 0 }, "south": { "uv": [12, 36, 16, 48], "texture": 0 }, "west": { "uv": [8, 36, 12, 48], "texture": 0 }, "up": { "uv": [8, 36, 4, 32], "texture": 0 }, "down": { "uv": [12, 32, 8, 36], "texture": 0 } }, "type": "cube", "uuid": "11f097f8-e1ce-844b-0d50-22caf024d66a" }, { "name": "Left Leg", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 0, -2], "to": [0.1, 12, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [16, 48], "faces": { "north": { "uv": [20, 52, 24, 64], "texture": 0 }, "east": { "uv": [16, 52, 20, 64], "texture": 0 }, "south": { "uv": [28, 52, 32, 64], "texture": 0 }, "west": { "uv": [24, 52, 28, 64], "texture": 0 }, "up": { "uv": [24, 52, 20, 48], "texture": 0 }, "down": { "uv": [28, 48, 24, 52], "texture": 0 } }, "type": "cube", "uuid": "6f882190-eb9f-072c-f2ea-1a6ba7097f38" }, { "name": "Left Leg Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 0, -2], "to": [0.1, 12, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 48], "faces": { "north": { "uv": [4, 52, 8, 64], "texture": 0 }, "east": { "uv": [0, 52, 4, 64], "texture": 0 }, "south": { "uv": [12, 52, 16, 64], "texture": 0 }, "west": { "uv": [8, 52, 12, 64], "texture": 0 }, "up": { "uv": [8, 52, 4, 48], "texture": 0 }, "down": { "uv": [12, 48, 8, 52], "texture": 0 } }, "type": "cube", "uuid": "04df0ec5-447d-5897-5394-3e864b89034d" }], "groups": [{ "name": "Waist", "uuid": "be57e35c-0d1f-73d0-a744-2ab50d9e9e7e", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Head", "uuid": "e9bfbcb2-c6aa-e6fb-2100-8206858b9808", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 24, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Body", "uuid": "fb3feba2-4753-2fb8-a4b8-73959be48ec9", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 24, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Arm", "uuid": "34d4c77c-3dab-0399-9415-895c7defb209", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [5, 22, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Arm", "uuid": "89763db0-9f19-9086-7b02-d5a3c6c1d2eb", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-5, 22, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Leg", "uuid": "ce0b7e2e-8994-95b6-191f-fe20e22e804b", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [1.9, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Leg", "uuid": "1b0596d6-5d55-b7a8-11ef-c0e5a6726ee0", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-1.9, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }], "outliner": [{ "uuid": "be57e35c-0d1f-73d0-a744-2ab50d9e9e7e", "isOpen": true, "children": [{ "uuid": "e9bfbcb2-c6aa-e6fb-2100-8206858b9808", "isOpen": true, "children": ["dcd7e8b4-f58c-cc99-2da3-b12ec0f84e26", "e7eba86e-ea3e-ba2b-83ed-234f05cb4e5a"] }, { "uuid": "fb3feba2-4753-2fb8-a4b8-73959be48ec9", "isOpen": true, "children": ["f8dedc1b-c1fa-41d8-b626-a8277bcc34cb", "28198e2f-03f4-2693-6abc-38aa0ea27713"] }, { "uuid": "34d4c77c-3dab-0399-9415-895c7defb209", "isOpen": true, "children": ["40941e09-3206-f7a6-276e-71da0d22d66a", "3d4cdef6-a626-a1c6-1d10-019ca9668f23"] }, { "uuid": "89763db0-9f19-9086-7b02-d5a3c6c1d2eb", "isOpen": true, "children": ["36c7f60a-6539-aba5-b1f3-5b30e1c41296", "031606c4-21ce-ab2b-3816-04fa634a0aff"] }] }, { "uuid": "ce0b7e2e-8994-95b6-191f-fe20e22e804b", "isOpen": true, "children": ["1cf9b045-7021-1d51-a272-f449bb18e430", "11f097f8-e1ce-844b-0d50-22caf024d66a"] }, { "uuid": "1b0596d6-5d55-b7a8-11ef-c0e5a6726ee0", "isOpen": true, "children": ["6f882190-eb9f-072c-f2ea-1a6ba7097f38", "04df0ec5-447d-5897-5394-3e864b89034d"] }], "textures": [{ "name": "steve64.png", "folder": "", "namespace": "", "id": "0", "group": "", "scope": 0, "width": 64, "height": 64, "uv_width": 64, "uv_height": 64, "particle": false, "use_as_default": false, "layers_enabled": false, "sync_to_project": "", "file_format": "png", "render_mode": "default", "render_sides": "auto", "wrap_mode": "limited", "pbr_channel": "color", "fps": 7, "frame_time": 1, "frame_order_type": "loop", "frame_order": "", "frame_interpolate": false, "visible": true, "internal": true, "saved": true, "uuid": "af233fb5-e15d-5eb1-7397-21ddfaab6bb3" }] },
    "root": { "meta": { "format_version": "5.0", "model_format": "m3sl_3d_skin", "box_uv": true }, "name": "skins_model_root", "model_identifier": "skins_model_root", "visible_box": [1, 1, 0], "variable_placeholders": "", "multi_file_ruleset": "", "variable_placeholder_buttons": [], "timeline_setups": [], "unhandled_root_fields": {}, "resolution": { "width": 64, "height": 64 }, "elements": [{ "name": "Head", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 24, -4], "to": [4, 32, 4], "autouv": 0, "color": 0, "origin": [0, 0, 0], "faces": { "north": { "uv": [8, 8, 16, 16], "texture": 0 }, "east": { "uv": [0, 8, 8, 16], "texture": 0 }, "south": { "uv": [24, 8, 32, 16], "texture": 0 }, "west": { "uv": [16, 8, 24, 16], "texture": 0 }, "up": { "uv": [16, 8, 8, 0], "texture": 0 }, "down": { "uv": [24, 0, 16, 8], "texture": 0 } }, "type": "cube", "uuid": "02509d8d-5e85-a913-eac6-229cc02e6d94" }, { "name": "Hat Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 24, -4], "to": [4, 32, 4], "autouv": 0, "color": 0, "inflate": 0.5, "origin": [0, 0, 0], "uv_offset": [32, 0], "faces": { "north": { "uv": [40, 8, 48, 16], "texture": 0 }, "east": { "uv": [32, 8, 40, 16], "texture": 0 }, "south": { "uv": [56, 8, 64, 16], "texture": 0 }, "west": { "uv": [48, 8, 56, 16], "texture": 0 }, "up": { "uv": [48, 8, 40, 0], "texture": 0 }, "down": { "uv": [56, 0, 48, 8], "texture": 0 } }, "type": "cube", "uuid": "413f5c34-ee39-552c-6d3b-61ac97a27182" }, { "name": "Body", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [16, 16], "faces": { "north": { "uv": [20, 20, 28, 32], "texture": 0 }, "east": { "uv": [16, 20, 20, 32], "texture": 0 }, "south": { "uv": [32, 20, 40, 32], "texture": 0 }, "west": { "uv": [28, 20, 32, 32], "texture": 0 }, "up": { "uv": [28, 20, 20, 16], "texture": 0 }, "down": { "uv": [36, 16, 28, 20], "texture": 0 } }, "type": "cube", "uuid": "b05b7996-be6b-85cc-c224-34982e29531a" }, { "name": "Body Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [16, 32], "faces": { "north": { "uv": [20, 36, 28, 48], "texture": 0 }, "east": { "uv": [16, 36, 20, 48], "texture": 0 }, "south": { "uv": [32, 36, 40, 48], "texture": 0 }, "west": { "uv": [28, 36, 32, 48], "texture": 0 }, "up": { "uv": [28, 36, 20, 32], "texture": 0 }, "down": { "uv": [36, 32, 28, 36], "texture": 0 } }, "type": "cube", "uuid": "dc4c6873-b97e-e953-f7f1-3447e55a910b" }, { "name": "Right Arm", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 12, -2], "to": [8, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [40, 16], "faces": { "north": { "uv": [44, 20, 48, 32], "texture": 0 }, "east": { "uv": [40, 20, 44, 32], "texture": 0 }, "south": { "uv": [52, 20, 56, 32], "texture": 0 }, "west": { "uv": [48, 20, 52, 32], "texture": 0 }, "up": { "uv": [48, 20, 44, 16], "texture": 0 }, "down": { "uv": [52, 16, 48, 20], "texture": 0 } }, "type": "cube", "uuid": "de994ad3-b261-7c62-ac5e-4773c4d72183" }, { "name": "Right Arm Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 12, -2], "to": [8, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [40, 32], "faces": { "north": { "uv": [44, 36, 48, 48], "texture": 0 }, "east": { "uv": [40, 36, 44, 48], "texture": 0 }, "south": { "uv": [52, 36, 56, 48], "texture": 0 }, "west": { "uv": [48, 36, 52, 48], "texture": 0 }, "up": { "uv": [48, 36, 44, 32], "texture": 0 }, "down": { "uv": [52, 32, 48, 36], "texture": 0 } }, "type": "cube", "uuid": "fd5db088-9792-9f65-9aa5-e0f960a41c2d" }, { "name": "Left Arm", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 12, -2], "to": [-4, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [32, 48], "faces": { "north": { "uv": [36, 52, 40, 64], "texture": 0 }, "east": { "uv": [32, 52, 36, 64], "texture": 0 }, "south": { "uv": [44, 52, 48, 64], "texture": 0 }, "west": { "uv": [40, 52, 44, 64], "texture": 0 }, "up": { "uv": [40, 52, 36, 48], "texture": 0 }, "down": { "uv": [44, 48, 40, 52], "texture": 0 } }, "type": "cube", "uuid": "34e4f132-2ade-6013-1c36-2472e33a5fdc" }, { "name": "Left Arm Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 12, -2], "to": [-4, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [48, 48], "faces": { "north": { "uv": [52, 52, 56, 64], "texture": 0 }, "east": { "uv": [48, 52, 52, 64], "texture": 0 }, "south": { "uv": [60, 52, 64, 64], "texture": 0 }, "west": { "uv": [56, 52, 60, 64], "texture": 0 }, "up": { "uv": [56, 52, 52, 48], "texture": 0 }, "down": { "uv": [60, 48, 56, 52], "texture": 0 } }, "type": "cube", "uuid": "00677be3-5ca5-a8ef-cb5a-36e37a5c9b4d" }, { "name": "Right Leg", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 0, -2], "to": [3.9, 12, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [0, 16], "faces": { "north": { "uv": [4, 20, 8, 32], "texture": 0 }, "east": { "uv": [0, 20, 4, 32], "texture": 0 }, "south": { "uv": [12, 20, 16, 32], "texture": 0 }, "west": { "uv": [8, 20, 12, 32], "texture": 0 }, "up": { "uv": [8, 20, 4, 16], "texture": 0 }, "down": { "uv": [12, 16, 8, 20], "texture": 0 } }, "type": "cube", "uuid": "967d0c46-9394-c41a-1164-b20abe727dcb" }, { "name": "Right Leg Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 0, -2], "to": [3.9, 12, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 32], "faces": { "north": { "uv": [4, 36, 8, 48], "texture": 0 }, "east": { "uv": [0, 36, 4, 48], "texture": 0 }, "south": { "uv": [12, 36, 16, 48], "texture": 0 }, "west": { "uv": [8, 36, 12, 48], "texture": 0 }, "up": { "uv": [8, 36, 4, 32], "texture": 0 }, "down": { "uv": [12, 32, 8, 36], "texture": 0 } }, "type": "cube", "uuid": "7e4e6ea2-053b-c784-7207-e68c70501694" }, { "name": "Left Leg", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 0, -2], "to": [0.1, 12, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [16, 48], "faces": { "north": { "uv": [20, 52, 24, 64], "texture": 0 }, "east": { "uv": [16, 52, 20, 64], "texture": 0 }, "south": { "uv": [28, 52, 32, 64], "texture": 0 }, "west": { "uv": [24, 52, 28, 64], "texture": 0 }, "up": { "uv": [24, 52, 20, 48], "texture": 0 }, "down": { "uv": [28, 48, 24, 52], "texture": 0 } }, "type": "cube", "uuid": "c0564ffb-302e-2e59-2d8f-08a4f2bbff0d" }, { "name": "Left Leg Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 0, -2], "to": [0.1, 12, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 48], "faces": { "north": { "uv": [4, 52, 8, 64], "texture": 0 }, "east": { "uv": [0, 52, 4, 64], "texture": 0 }, "south": { "uv": [12, 52, 16, 64], "texture": 0 }, "west": { "uv": [8, 52, 12, 64], "texture": 0 }, "up": { "uv": [8, 52, 4, 48], "texture": 0 }, "down": { "uv": [12, 48, 8, 52], "texture": 0 } }, "type": "cube", "uuid": "faab2e47-d1e7-c095-622a-b973b4fcfa00" }], "groups": [{ "name": "Waist", "uuid": "0c205e67-3cfe-a79e-5ae5-0cc8f5a3f5b0", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Head", "uuid": "bd1dd13e-30c7-92c2-5a14-293e01b0de33", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 24, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Body", "uuid": "8fc16d45-9fba-4034-37e9-2f46c2292e19", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 24, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Arm", "uuid": "e2322f0b-b048-6263-c046-532172162379", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [5, 22, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Arm", "uuid": "504dcfee-e14e-3f72-6b81-3ce135634938", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-5, 22, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Leg", "uuid": "d0bac479-6214-1441-b31a-b7ff5ae26b4a", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [1.9, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Leg", "uuid": "a9812c3c-d97d-5456-443a-234fe66df480", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-1.9, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "root", "uuid": "e07e4769-599f-8ab1-2101-90885fdbe299", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": true }], "outliner": [{ "uuid": "e07e4769-599f-8ab1-2101-90885fdbe299", "isOpen": true, "children": [{ "uuid": "0c205e67-3cfe-a79e-5ae5-0cc8f5a3f5b0", "isOpen": true, "children": [{ "uuid": "bd1dd13e-30c7-92c2-5a14-293e01b0de33", "isOpen": true, "children": ["02509d8d-5e85-a913-eac6-229cc02e6d94", "413f5c34-ee39-552c-6d3b-61ac97a27182"] }, { "uuid": "8fc16d45-9fba-4034-37e9-2f46c2292e19", "isOpen": true, "children": ["b05b7996-be6b-85cc-c224-34982e29531a", "dc4c6873-b97e-e953-f7f1-3447e55a910b"] }, { "uuid": "e2322f0b-b048-6263-c046-532172162379", "isOpen": true, "children": ["de994ad3-b261-7c62-ac5e-4773c4d72183", "fd5db088-9792-9f65-9aa5-e0f960a41c2d"] }, { "uuid": "504dcfee-e14e-3f72-6b81-3ce135634938", "isOpen": true, "children": ["34e4f132-2ade-6013-1c36-2472e33a5fdc", "00677be3-5ca5-a8ef-cb5a-36e37a5c9b4d"] }] }, { "uuid": "d0bac479-6214-1441-b31a-b7ff5ae26b4a", "isOpen": true, "children": ["967d0c46-9394-c41a-1164-b20abe727dcb", "7e4e6ea2-053b-c784-7207-e68c70501694"] }, { "uuid": "a9812c3c-d97d-5456-443a-234fe66df480", "isOpen": true, "children": ["c0564ffb-302e-2e59-2d8f-08a4f2bbff0d", "faab2e47-d1e7-c095-622a-b973b4fcfa00"] }] }], "textures": [{ "name": "temp-64.png", "folder": "", "namespace": "", "id": "0", "group": "", "scope": 0, "width": 64, "height": 64, "uv_width": 64, "uv_height": 64, "particle": false, "use_as_default": false, "layers_enabled": false, "sync_to_project": "", "file_format": "png", "render_mode": "default", "render_sides": "auto", "wrap_mode": "limited", "pbr_channel": "color", "fps": 7, "frame_time": 1, "frame_order_type": "loop", "frame_order": "", "frame_interpolate": false, "visible": true, "internal": true, "saved": true, "uuid": "69a5197e-c856-2e26-2d2c-2d905a8a7945" }] },
    "joint": { "meta": { "format_version": "5.0", "model_format": "m3sl_3d_skin", "box_uv": true }, "name": "skins_model_root_joint", "model_identifier": "skins_model_root", "visible_box": [1, 1, 0], "variable_placeholders": "", "multi_file_ruleset": "", "variable_placeholder_buttons": [], "timeline_setups": [], "unhandled_root_fields": {}, "resolution": { "width": 64, "height": 64 }, "elements": [{ "name": "Head", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 24, -4], "to": [4, 32, 4], "autouv": 0, "color": 0, "origin": [0, 0, 0], "faces": { "north": { "uv": [8, 8, 16, 16], "texture": 0 }, "east": { "uv": [0, 8, 8, 16], "texture": 0 }, "south": { "uv": [24, 8, 32, 16], "texture": 0 }, "west": { "uv": [16, 8, 24, 16], "texture": 0 }, "up": { "uv": [16, 8, 8, 0], "texture": 0 }, "down": { "uv": [24, 0, 16, 8], "texture": 0 } }, "type": "cube", "uuid": "02509d8d-5e85-a913-eac6-229cc02e6d94" }, { "name": "Hat Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 24, -4], "to": [4, 32, 4], "autouv": 0, "color": 0, "inflate": 0.5, "origin": [0, 0, 0], "uv_offset": [32, 0], "faces": { "north": { "uv": [40, 8, 48, 16], "texture": 0 }, "east": { "uv": [32, 8, 40, 16], "texture": 0 }, "south": { "uv": [56, 8, 64, 16], "texture": 0 }, "west": { "uv": [48, 8, 56, 16], "texture": 0 }, "up": { "uv": [48, 8, 40, 0], "texture": 0 }, "down": { "uv": [56, 0, 48, 8], "texture": 0 } }, "type": "cube", "uuid": "413f5c34-ee39-552c-6d3b-61ac97a27182" }, { "name": "Body1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 16, -2], "to": [4, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [16, 16], "faces": { "north": { "uv": [20, 20, 28, 28], "texture": 0 }, "east": { "uv": [16, 20, 20, 28], "texture": 0 }, "south": { "uv": [32, 20, 40, 28], "texture": 0 }, "west": { "uv": [28, 20, 32, 28], "texture": 0 }, "up": { "uv": [28, 20, 20, 16], "texture": 0 }, "down": { "uv": [36, 16, 28, 20], "texture": 0 } }, "type": "cube", "uuid": "b05b7996-be6b-85cc-c224-34982e29531a" }, { "name": "Body Layer1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 24, 2], "autouv": 0, "color": 0, "visibility": false, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [16, 32], "faces": { "north": { "uv": [20, 36, 28, 48], "texture": 0 }, "east": { "uv": [16, 36, 20, 48], "texture": 0 }, "south": { "uv": [32, 36, 40, 48], "texture": 0 }, "west": { "uv": [28, 36, 32, 48], "texture": 0 }, "up": { "uv": [28, 36, 20, 32], "texture": 0 }, "down": { "uv": [36, 32, 28, 36], "texture": 0 } }, "type": "cube", "uuid": "dc4c6873-b97e-e953-f7f1-3447e55a910b" }, { "name": "Right Arm Layer1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 18, -2], "to": [8, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [40, 32], "faces": { "north": { "uv": [44, 36, 48, 42], "texture": 0 }, "east": { "uv": [40, 36, 44, 42], "texture": 0 }, "south": { "uv": [52, 36, 56, 42], "texture": 0 }, "west": { "uv": [48, 36, 52, 42], "texture": 0 }, "up": { "uv": [48, 36, 44, 32], "texture": 0 }, "down": { "uv": [52, 32, 48, 36], "texture": 0 } }, "type": "cube", "uuid": "fd5db088-9792-9f65-9aa5-e0f960a41c2d" }, { "name": "Left Arm", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 18, -2], "to": [-4, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [32, 48], "faces": { "north": { "uv": [36, 52, 40, 58], "texture": 0 }, "east": { "uv": [32, 52, 36, 58], "texture": 0 }, "south": { "uv": [44, 52, 48, 58], "texture": 0 }, "west": { "uv": [40, 52, 44, 58], "texture": 0 }, "up": { "uv": [40, 52, 36, 48], "texture": 0 }, "down": { "uv": [44, 48, 40, 52], "texture": 0 } }, "type": "cube", "uuid": "34e4f132-2ade-6013-1c36-2472e33a5fdc" }, { "name": "Left Arm Layer", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 18, -2], "to": [-4, 24, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [48, 48], "faces": { "north": { "uv": [52, 52, 56, 58], "texture": 0 }, "east": { "uv": [48, 52, 52, 58], "texture": 0 }, "south": { "uv": [60, 52, 64, 58], "texture": 0 }, "west": { "uv": [56, 52, 60, 58], "texture": 0 }, "up": { "uv": [56, 52, 52, 48], "texture": 0 }, "down": { "uv": [60, 48, 56, 52], "texture": 0 } }, "type": "cube", "uuid": "00677be3-5ca5-a8ef-cb5a-36e37a5c9b4d" }, { "name": "Right Leg1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 6, -2], "to": [3.9, 12, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [0, 16], "faces": { "north": { "uv": [4, 20, 8, 26], "texture": 0 }, "east": { "uv": [0, 20, 4, 26], "texture": 0 }, "south": { "uv": [12, 20, 16, 26], "texture": 0 }, "west": { "uv": [8, 20, 12, 26], "texture": 0 }, "up": { "uv": [8, 20, 4, 16], "texture": 0 }, "down": { "uv": [12, 16, 8, 20], "texture": 0 } }, "type": "cube", "uuid": "967d0c46-9394-c41a-1164-b20abe727dcb" }, { "name": "Right Leg Layer1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 6, -2], "to": [3.9, 12, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 32], "faces": { "north": { "uv": [4, 36, 8, 42], "texture": 0 }, "east": { "uv": [0, 36, 4, 42], "texture": 0 }, "south": { "uv": [12, 36, 16, 42], "texture": 0 }, "west": { "uv": [8, 36, 12, 42], "texture": 0 }, "up": { "uv": [8, 36, 4, 32], "texture": 0 }, "down": { "uv": [12, 32, 8, 36], "texture": 0 } }, "type": "cube", "uuid": "7e4e6ea2-053b-c784-7207-e68c70501694" }, { "name": "Left Leg1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 6, -2], "to": [0.1, 12, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [16, 48], "faces": { "north": { "uv": [20, 52, 24, 58], "texture": 0 }, "east": { "uv": [16, 52, 20, 58], "texture": 0 }, "south": { "uv": [28, 52, 32, 58], "texture": 0 }, "west": { "uv": [24, 52, 28, 58], "texture": 0 }, "up": { "uv": [24, 52, 20, 48], "texture": 0 }, "down": { "uv": [28, 48, 24, 52], "texture": 0 } }, "type": "cube", "uuid": "c0564ffb-302e-2e59-2d8f-08a4f2bbff0d" }, { "name": "Left Leg Layer1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 6, -2], "to": [0.1, 12, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 48], "faces": { "north": { "uv": [4, 52, 8, 58], "texture": 0 }, "east": { "uv": [0, 52, 4, 58], "texture": 0 }, "south": { "uv": [12, 52, 16, 58], "texture": 0 }, "west": { "uv": [8, 52, 12, 58], "texture": 0 }, "up": { "uv": [8, 52, 4, 48], "texture": 0 }, "down": { "uv": [12, 48, 8, 52], "texture": 0 } }, "type": "cube", "uuid": "faab2e47-d1e7-c095-622a-b973b4fcfa00" }, { "name": "Body2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 16, 2], "autouv": 0, "color": 0, "origin": [0, -4, 0], "uv_offset": [16, 24], "faces": { "north": { "uv": [20, 28, 28, 32], "texture": 0 }, "east": { "uv": [16, 28, 20, 32], "texture": 0 }, "south": { "uv": [32, 28, 40, 32], "texture": 0 }, "west": { "uv": [28, 28, 32, 32], "texture": 0 }, "up": { "uv": [36, 20, 28, 16], "texture": 0 }, "down": { "uv": [28, 16, 20, 20], "texture": 0 } }, "type": "cube", "uuid": "4ae22003-e541-bdf6-3f1b-8a2f6c2a05cd" }, { "name": "Right Arm1", "box_uv": true, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 18, -2], "to": [8, 24, 2], "autouv": 0, "color": 0, "origin": [0, 0, 0], "uv_offset": [40, 16], "faces": { "north": { "uv": [44, 20, 48, 26], "texture": 0 }, "east": { "uv": [40, 20, 44, 26], "texture": 0 }, "south": { "uv": [52, 20, 56, 26], "texture": 0 }, "west": { "uv": [48, 20, 52, 26], "texture": 0 }, "up": { "uv": [48, 20, 44, 16], "texture": 0 }, "down": { "uv": [52, 16, 48, 20], "texture": 0 } }, "type": "cube", "uuid": "de994ad3-b261-7c62-ac5e-4773c4d72183" }, { "name": "Right Arm2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [4, 12, -2], "to": [8, 18, 2], "autouv": 0, "color": 0, "origin": [0, -6, 0], "uv_offset": [40, 22], "faces": { "north": { "uv": [44, 26, 48, 32], "texture": 0 }, "east": { "uv": [40, 26, 44, 32], "texture": 0 }, "south": { "uv": [52, 26, 56, 32], "texture": 0 }, "west": { "uv": [48, 26, 52, 32], "texture": 0 }, "up": { "uv": [48, 20, 44, 16], "texture": 0 }, "down": { "uv": [52, 16, 48, 20], "texture": 0 } }, "type": "cube", "uuid": "43be4fe2-4031-8bea-5fed-1f40691681ea" }, { "name": "Left Arm2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 12, -2], "to": [-4, 18, 2], "autouv": 0, "color": 0, "origin": [0, -6, 0], "uv_offset": [32, 54], "faces": { "north": { "uv": [36, 58, 40, 64], "texture": 0 }, "east": { "uv": [32, 58, 36, 64], "texture": 0 }, "south": { "uv": [44, 58, 48, 64], "texture": 0 }, "west": { "uv": [40, 58, 44, 64], "texture": 0 }, "up": { "uv": [40, 52, 36, 48], "texture": 0 }, "down": { "uv": [44, 48, 40, 52], "texture": 0 } }, "type": "cube", "uuid": "10ba3614-240a-cedd-4216-4d79128b4ff2" }, { "name": "Body Layer2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-4, 12, -2], "to": [4, 16, 2], "autouv": 0, "color": 0, "origin": [0, -4, 0], "uv_offset": [16, 24], "faces": { "north": { "uv": [20, 44, 28, 48], "texture": 0 }, "east": { "uv": [16, 44, 20, 48], "texture": 0 }, "south": { "uv": [32, 44, 40, 48], "texture": 0 }, "west": { "uv": [28, 44, 32, 48], "texture": 0 }, "up": { "uv": [36, 36, 28, 32], "texture": 0 }, "down": { "uv": [28, 32, 20, 36], "texture": 0 } }, "type": "cube", "uuid": "48269300-2009-1c36-4f8c-8602f4dd869c" }, { "name": "Left Arm Layer2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-8, 12, -2], "to": [-4, 18, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, -6, 0], "uv_offset": [48, 48], "faces": { "north": { "uv": [52, 58, 56, 64], "texture": 0 }, "east": { "uv": [48, 58, 52, 64], "texture": 0 }, "south": { "uv": [60, 58, 64, 64], "texture": 0 }, "west": { "uv": [56, 58, 60, 64], "texture": 0 }, "up": { "uv": [56, 52, 52, 48], "texture": 0 }, "down": { "uv": [60, 48, 56, 52], "texture": 0 } }, "type": "cube", "uuid": "76a8df64-3712-6097-ad75-b4bb8530d6ba" }, { "name": "Right Leg2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 0, -2], "to": [3.9, 6, 2], "autouv": 0, "color": 0, "origin": [0, -6, 0], "uv_offset": [0, 22], "faces": { "north": { "uv": [4, 26, 8, 32], "texture": 0 }, "east": { "uv": [0, 26, 4, 32], "texture": 0 }, "south": { "uv": [12, 26, 16, 32], "texture": 0 }, "west": { "uv": [8, 26, 12, 32], "texture": 0 }, "up": { "uv": [8, 20, 4, 16], "texture": 0 }, "down": { "uv": [12, 16, 8, 20], "texture": 0 } }, "type": "cube", "uuid": "d78dc7b8-034b-33d0-7958-cea4e8f1cb20" }, { "name": "Right Leg Layer2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-0.1, 0, -2], "to": [3.9, 6, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [0, 0, 0], "uv_offset": [0, 38], "faces": { "north": { "uv": [4, 42, 8, 48], "texture": 0 }, "east": { "uv": [0, 42, 4, 48], "texture": 0 }, "south": { "uv": [12, 42, 16, 48], "texture": 0 }, "west": { "uv": [8, 42, 12, 48], "texture": 0 }, "up": { "uv": [11, 36, 7, 32], "texture": 0 }, "down": { "uv": [11, 32, 7, 36], "texture": 0 } }, "type": "cube", "uuid": "04c9cf0e-a669-0ca9-7276-a98231a20609" }, { "name": "Left Leg2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 0, -2], "to": [0.1, 6, 2], "autouv": 0, "color": 0, "origin": [0, -6, 0], "uv_offset": [16, 54], "faces": { "north": { "uv": [20, 58, 24, 64], "texture": 0 }, "east": { "uv": [16, 58, 20, 64], "texture": 0 }, "south": { "uv": [28, 58, 32, 64], "texture": 0 }, "west": { "uv": [24, 58, 28, 64], "texture": 0 }, "up": { "uv": [24, 52, 20, 48], "texture": 0 }, "down": { "uv": [28, 48, 24, 52], "texture": 0 } }, "type": "cube", "uuid": "d605b7e8-7854-164f-77be-f9ecadf2fdc5" }, { "name": "Left Leg Layer2", "box_uv": false, "render_order": "default", "locked": false, "export": true, "scope": 0, "allow_mirror_modeling": true, "from": [-3.9, 0, -2], "to": [0.1, 6, 2], "autouv": 0, "color": 0, "inflate": 0.25, "origin": [-2, 6, 0], "uv_offset": [0, 53], "faces": { "north": { "uv": [4, 57, 8, 63], "texture": 0 }, "east": { "uv": [0, 57, 4, 63], "texture": 0 }, "south": { "uv": [12, 57, 16, 63], "texture": 0 }, "west": { "uv": [8, 57, 12, 63], "texture": 0 }, "up": { "uv": [11, 52, 7, 48], "texture": 0 }, "down": { "uv": [11, 48, 7, 52], "texture": 0 } }, "type": "cube", "uuid": "a5f7bbdf-ebc1-f81c-48c3-c6f8a2fce36c" }], "groups": [{ "name": "Waist", "uuid": "0c205e67-3cfe-a79e-5ae5-0cc8f5a3f5b0", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Head", "uuid": "bd1dd13e-30c7-92c2-5a14-293e01b0de33", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 24, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": false, "primary_selected": false }, { "name": "Body", "uuid": "8fc16d45-9fba-4034-37e9-2f46c2292e19", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 24, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Arm", "uuid": "e2322f0b-b048-6263-c046-532172162379", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [5, 22, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Arm", "uuid": "504dcfee-e14e-3f72-6b81-3ce135634938", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-5, 22, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Leg", "uuid": "d0bac479-6214-1441-b31a-b7ff5ae26b4a", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [1.9, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Leg", "uuid": "a9812c3c-d97d-5456-443a-234fe66df480", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-1.9, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "root", "uuid": "e07e4769-599f-8ab1-2101-90885fdbe299", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Arm1", "uuid": "1f5fd7de-b5b3-aed9-32c5-9010dfcd6a5b", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 0, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Arm2", "uuid": "71fcaaf8-9416-d98f-a058-857921ba019c", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [6, 18, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Body2", "uuid": "442e502f-7669-0738-3c3f-db0a761783da", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, -4, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Body1", "uuid": "f7782bd2-92b5-dbc0-1153-4f01c7bf1ec5", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 0, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Arm2", "uuid": "b582a6b5-a0a2-f4a0-6264-007d06e273f0", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-6, 18, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left Arm1", "uuid": "4a9bc1fd-f0a9-2105-3d95-860a127fda44", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 0, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left_Leg2", "uuid": "7f4f3a11-3275-2537-385a-26619b318587", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-2, 6, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Left_Leg1", "uuid": "26a7c291-0fa8-c533-e16d-11f735c0ec49", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [-2, 11, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Leg2", "uuid": "5a6b3441-1a4e-7d6a-e49b-1259918f2df0", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [2, 6, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "Right Leg1", "uuid": "dbad7ac0-a112-a028-7707-b01fa886e5ca", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [2, 11, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }, { "name": "group", "uuid": "7ef13f09-0217-0d18-6de3-dc090d4d6132", "export": true, "locked": false, "scope": 0, "selected": false, "_static": { "properties": {}, "temp_data": {} }, "origin": [0, 12, 0], "rotation": [0, 0, 0], "color": 0, "m3sl_source": {}, "children": [], "reset": false, "shade": true, "mirror_uv": false, "visibility": true, "autouv": 0, "isOpen": true, "primary_selected": false }], "outliner": [{ "uuid": "e07e4769-599f-8ab1-2101-90885fdbe299", "isOpen": true, "children": [{ "uuid": "0c205e67-3cfe-a79e-5ae5-0cc8f5a3f5b0", "isOpen": true, "children": [{ "uuid": "bd1dd13e-30c7-92c2-5a14-293e01b0de33", "isOpen": false, "children": ["02509d8d-5e85-a913-eac6-229cc02e6d94", "413f5c34-ee39-552c-6d3b-61ac97a27182"] }, { "uuid": "8fc16d45-9fba-4034-37e9-2f46c2292e19", "isOpen": true, "children": [{ "uuid": "f7782bd2-92b5-dbc0-1153-4f01c7bf1ec5", "isOpen": true, "children": ["b05b7996-be6b-85cc-c224-34982e29531a", "dc4c6873-b97e-e953-f7f1-3447e55a910b"] }, { "uuid": "442e502f-7669-0738-3c3f-db0a761783da", "isOpen": true, "children": ["4ae22003-e541-bdf6-3f1b-8a2f6c2a05cd", "48269300-2009-1c36-4f8c-8602f4dd869c"] }] }, { "uuid": "e2322f0b-b048-6263-c046-532172162379", "isOpen": true, "children": [{ "uuid": "1f5fd7de-b5b3-aed9-32c5-9010dfcd6a5b", "isOpen": true, "children": ["de994ad3-b261-7c62-ac5e-4773c4d72183", "fd5db088-9792-9f65-9aa5-e0f960a41c2d"] }, { "uuid": "71fcaaf8-9416-d98f-a058-857921ba019c", "isOpen": true, "children": ["43be4fe2-4031-8bea-5fed-1f40691681ea"] }] }, { "uuid": "504dcfee-e14e-3f72-6b81-3ce135634938", "isOpen": true, "children": [{ "uuid": "4a9bc1fd-f0a9-2105-3d95-860a127fda44", "isOpen": true, "children": ["34e4f132-2ade-6013-1c36-2472e33a5fdc", "00677be3-5ca5-a8ef-cb5a-36e37a5c9b4d"] }, { "uuid": "b582a6b5-a0a2-f4a0-6264-007d06e273f0", "isOpen": true, "children": ["10ba3614-240a-cedd-4216-4d79128b4ff2", "76a8df64-3712-6097-ad75-b4bb8530d6ba"] }] }] }, { "uuid": "d0bac479-6214-1441-b31a-b7ff5ae26b4a", "isOpen": true, "children": [{ "uuid": "dbad7ac0-a112-a028-7707-b01fa886e5ca", "isOpen": true, "children": ["967d0c46-9394-c41a-1164-b20abe727dcb", "7e4e6ea2-053b-c784-7207-e68c70501694"] }, { "uuid": "5a6b3441-1a4e-7d6a-e49b-1259918f2df0", "isOpen": true, "children": ["d78dc7b8-034b-33d0-7958-cea4e8f1cb20", "04c9cf0e-a669-0ca9-7276-a98231a20609"] }] }, { "uuid": "a9812c3c-d97d-5456-443a-234fe66df480", "isOpen": true, "children": [{ "uuid": "26a7c291-0fa8-c533-e16d-11f735c0ec49", "isOpen": true, "children": ["c0564ffb-302e-2e59-2d8f-08a4f2bbff0d", "faab2e47-d1e7-c095-622a-b973b4fcfa00"] }, { "uuid": "7f4f3a11-3275-2537-385a-26619b318587", "isOpen": true, "children": ["d605b7e8-7854-164f-77be-f9ecadf2fdc5", "a5f7bbdf-ebc1-f81c-48c3-c6f8a2fce36c"] }] }, { "uuid": "7ef13f09-0217-0d18-6de3-dc090d4d6132", "isOpen": true, "children": [] }] }], "textures": [{ "name": "temp-64.png", "folder": "", "namespace": "", "id": "0", "group": "", "scope": 0, "width": 64, "height": 64, "uv_width": 64, "uv_height": 64, "particle": false, "use_as_default": false, "layers_enabled": false, "sync_to_project": "", "file_format": "png", "render_mode": "default", "render_sides": "auto", "wrap_mode": "limited", "pbr_channel": "color", "fps": 7, "frame_time": 1, "frame_order_type": "loop", "frame_order": "", "frame_interpolate": false, "visible": true, "internal": true, "saved": true, "uuid": "fb556ec0-5586-f2b9-a6ea-bf626558a960" }], "animations": [{ "uuid": "daa28a6e-edb2-384f-56df-726ca420eee1", "name": "animation", "loop": "once", "override": false, "length": 0, "snapping": 24, "selected": true, "group_name": "", "scope": 0, "anim_time_update": "", "blend_weight": "", "start_delay": "", "loop_delay": "", "animators": { "0c205e67-3cfe-a79e-5ae5-0cc8f5a3f5b0": { "name": "Waist", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "bd1dd13e-30c7-92c2-5a14-293e01b0de33": { "name": "Head", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "12.5", "y": "45", "z": "0" }], "uuid": "9ff9f8bc-ee90-c8d5-63c1-c0e0f3161b10", "time": 0, "color": -1, "interpolation": "linear" }] }, "8fc16d45-9fba-4034-37e9-2f46c2292e19": { "name": "Body", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "e2322f0b-b048-6263-c046-532172162379": { "name": "Right Arm", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "55", "y": "-30", "z": "0" }], "uuid": "7a89722e-6753-bf2f-524d-ce001bd4f4e8", "time": 0, "color": -1, "interpolation": "linear" }] }, "504dcfee-e14e-3f72-6b81-3ce135634938": { "name": "Left Arm", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "36.4201", "y": "-20.3441", "z": "-51.3908" }], "uuid": "bbf77a60-c941-cf1c-fb50-34c08061a9e7", "time": 0, "color": -1, "interpolation": "linear" }] }, "d0bac479-6214-1441-b31a-b7ff5ae26b4a": { "name": "Right Leg", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "62.5", "y": "0", "z": "0" }], "uuid": "ca512544-0fa6-21c5-5e8f-0f3d4ab8f23a", "time": 0, "color": -1, "interpolation": "linear" }] }, "a9812c3c-d97d-5456-443a-234fe66df480": { "name": "Left Leg", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "-27.5", "y": "-17.5", "z": "-17.5" }], "uuid": "c0336bc0-4d40-5797-f22e-26a61af62ee3", "time": 0, "color": -1, "interpolation": "linear" }] }, "e07e4769-599f-8ab1-2101-90885fdbe299": { "name": "root", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "-21.6297", "y": "-31.7742", "z": "-41.1709" }], "uuid": "41856b5b-cbd9-7a5c-1e3d-10b11a0f41bc", "time": 0, "color": -1, "interpolation": "linear" }] }, "1f5fd7de-b5b3-aed9-32c5-9010dfcd6a5b": { "name": "Right Arm1", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "71fcaaf8-9416-d98f-a058-857921ba019c": { "name": "Right Arm2", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "17.5", "y": "0", "z": "0" }], "uuid": "71269d33-f526-3f3a-08fb-c97875b94dff", "time": 0, "color": -1, "interpolation": "linear" }] }, "442e502f-7669-0738-3c3f-db0a761783da": { "name": "Body2", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "f7782bd2-92b5-dbc0-1153-4f01c7bf1ec5": { "name": "Body1", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "b582a6b5-a0a2-f4a0-6264-007d06e273f0": { "name": "Left Arm2", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "42.5", "y": "0", "z": "0" }], "uuid": "cdc5615c-bc73-e4e0-1fd9-09714cb6a373", "time": 0, "color": -1, "interpolation": "linear" }] }, "4a9bc1fd-f0a9-2105-3d95-860a127fda44": { "name": "Left Arm1", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "7f4f3a11-3275-2537-385a-26619b318587": { "name": "Left_Leg2", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "-17.5", "y": "0", "z": "0" }], "uuid": "5e0242c0-b419-c032-e5b3-72a2704a3252", "time": 0, "color": -1, "interpolation": "linear" }] }, "26a7c291-0fa8-c533-e16d-11f735c0ec49": { "name": "Left_Leg1", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "5a6b3441-1a4e-7d6a-e49b-1259918f2df0": { "name": "Right Leg2", "type": "bone", "rotation_global": false, "quaternion_interpolation": false, "keyframes": [{ "channel": "rotation", "data_points": [{ "x": "-70", "y": "0", "z": "0" }], "uuid": "8609d951-34d2-2924-695c-ea492f70bed6", "time": 0, "color": -1, "interpolation": "linear" }] }, "dbad7ac0-a112-a028-7707-b01fa886e5ca": { "name": "Right Leg1", "type": "bone", "rotation_global": false, "quaternion_interpolation": false }, "7ef13f09-0217-0d18-6de3-dc090d4d6132": { "name": "group", "type": "bone", "rotation_global": false, "quaternion_interpolation": false } } }] }
  };
  var TEMP_TEXTURE_DATA_URLS = {
    64: "data:image/png;base64,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",
    128: "data:image/png;base64,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"
  };

  // src/ui/resultReporter.ts
  function toast(text, icon = "view_in_ar") {
    Blockbench.showToastNotification({ text, icon });
  }
  function status(text) {
    Blockbench.showStatusMessage(text, 4e3);
  }
  function reportNoLayers() {
    toast(t("m3sl.toast.no_layers"), "info");
  }
  function reportNoRestorableGroups() {
    toast(t("m3sl.toast.no_restorable_groups"), "info");
  }
  function reportBusy() {
    toast(t("m3sl.toast.busy"), "hourglass_empty");
  }
  function reportVoxelLimit(error) {
    toast(t("m3sl.toast.limit", [error.voxelCount, error.limit]), "warning");
  }
  function reportGenerationResult(result, note) {
    const seconds = (result.durationMs / 1e3).toFixed(2);
    toast(
      t("m3sl.toast.generated", [result.createdCubes, result.createdGroups, seconds]) + (note ? " " + note : "") + (result.warnings.length ? " " + t("m3sl.toast.warnings", [result.warnings.length]) : ""),
      "view_in_ar"
    );
    for (const warning of result.warnings) {
      console.warn(`[minecraft_3d_skin_layers] ${warning}`);
    }
  }
  function reportRestoreResult(result, note) {
    toast(t("m3sl.toast.restored", [result.restoredCubes, result.removedVoxels]) + (note ? " " + note : ""), "unarchive");
  }
  function reportCleared(summary) {
    if (summary.removed === 0) {
      toast(t("m3sl.toast.no_transparent"), "info");
    } else {
      toast(
        t("m3sl.toast.cleared", [summary.removed]) + (summary.warnings.length ? " " + t("m3sl.toast.warnings", [summary.warnings.length]) : ""),
        "layers_clear"
      );
    }
    for (const warning of summary.warnings) {
      console.warn(`[minecraft_3d_skin_layers] ${warning}`);
    }
  }
  function reportError(error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[minecraft_3d_skin_layers] generation failed:", error);
    toast(t("m3sl.toast.failed", [message]), "error");
  }
  function reportRestoreError(error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[minecraft_3d_skin_layers] restore failed:", error);
    toast(t("m3sl.toast.restore_failed", [message]), "error");
  }

  // src/newSkin/templates.ts
  var TEMPLATE_IDS = ["classic", "root", "joint"];
  var SKIN_SIZES = [64, 128];
  function buildTemplateModel(id, size) {
    const source = EMBEDDED_TEMPLATES[id];
    if (!source) {
      throw new Error(`Unknown template: ${id}`);
    }
    const dataUrl = TEMP_TEXTURE_DATA_URLS[size];
    if (!dataUrl) {
      throw new Error(`No temp skin texture embedded for size ${size}`);
    }
    const model = JSON.parse(JSON.stringify(source));
    if (Array.isArray(model.textures)) {
      for (const texture of model.textures) {
        texture.source = dataUrl;
        texture.width = size;
        texture.height = size;
        texture.internal = true;
      }
    }
    if (model.meta) {
      model.meta.model_format = NEW_SKIN_FORMAT_ID;
    }
    return { model, projectName: `temp-${size}` };
  }

  // src/newSkin/newSkinDialog.ts
  function showNewSkinDialog(onConfirm, onCancel) {
    new Dialog({
      id: `${PLUGIN_ID}.new_skin_dialog`,
      title: t("m3sl.wizard.title"),
      width: 512,
      form: {
        intro: { type: "info", text: t("m3sl.wizard.intro") },
        template: {
          label: t("m3sl.wizard.template"),
          type: "select",
          value: "classic",
          options: {
            classic: t("m3sl.wizard.template.classic"),
            root: t("m3sl.wizard.template.root"),
            joint: t("m3sl.wizard.template.joint")
          }
        },
        size: {
          label: t("m3sl.wizard.size"),
          type: "select",
          value: "64",
          options: {
            64: "64 \xD7 64",
            128: "128 \xD7 128"
          }
        }
      },
      onConfirm(formResult) {
        const raw = formResult ?? {};
        const template = TEMPLATE_IDS.includes(raw.template) ? raw.template : "classic";
        const size = SKIN_SIZES.includes(raw.size) ? raw.size : 64;
        onConfirm({ template, size });
      },
      onClose() {
        onCancel();
      }
    }).show();
  }

  // src/newSkin/newSkinFormat.ts
  var registeredFormat;
  var creating = false;
  async function waitForTexturePixels(texture) {
    const img = texture.img;
    if (!img || img.complete) {
      return;
    }
    await new Promise((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }
  async function waitForProjectTextures(timeoutMs = 1e4) {
    const pending = Texture.all.map((texture) => waitForTexturePixels(texture));
    if (pending.length === 0) {
      return;
    }
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }
  async function createSkinProject(template, size) {
    if (creating || !registeredFormat) {
      return;
    }
    creating = true;
    try {
      const { model, projectName } = buildTemplateModel(template, size);
      newProject(registeredFormat);
      suppressAutoScanDuring(() => {
        const parse = Codecs.project.parse;
        if (typeof parse !== "function") {
          throw new Error("Blockbench project codec cannot parse models");
        }
        parse.call(Codecs.project, model, "");
      });
      Project.name = projectName;
      await waitForProjectTextures();
      const options = { ...loadOptions(), includeTransparent: true };
      const outcome = scanAndPlan(options);
      if (outcome.snapshots.length === 0) {
        reportNoLayers();
        return;
      }
      if (outcome.voxelCount > options.maxVoxels) {
        reportVoxelLimit(new VoxelLimitError(outcome.voxelCount, options.maxVoxels));
        return;
      }
      for (const plan of outcome.plans) {
        plan.visibility = true;
      }
      const result = await applyOutcome(outcome, options);
      toast(t("m3sl.toast.wizard_created", [result.createdCubes, (result.durationMs / 1e3).toFixed(2)]), "view_in_ar");
    } catch (error) {
      reportError(error);
    } finally {
      creating = false;
    }
  }
  function openWizard() {
    showNewSkinDialog(
      (selection) => {
        void createSkinProject(selection.template, selection.size);
      },
      () => void 0
    );
  }
  function registerNewSkinFormat() {
    registeredFormat = new ModelFormat(NEW_SKIN_FORMAT_ID, {
      icon: "view_in_ar",
      category: "minecraft",
      name: t("m3sl.format.name"),
      description: t("m3sl.format.description"),
      rotate_cubes: true,
      bone_rig: true,
      centered_grid: true,
      optional_box_uv: true,
      uv_rotation: true,
      animation_mode: true,
      new: () => {
        openWizard();
        return true;
      }
    });
  }
  function unregisterNewSkinFormat() {
    if (registeredFormat && typeof registeredFormat.delete === "function") {
      registeredFormat.delete();
    }
    registeredFormat = void 0;
  }

  // src/infra/logger.ts
  var logger = {
    info(message) {
      console.info(`[${PLUGIN_NAME}] ${message}`);
    },
    warn(message) {
      console.warn(`[${PLUGIN_NAME}] ${message}`);
    },
    error(message, error) {
      console.error(`[${PLUGIN_NAME}] ${message}`, error);
    }
  };
  var PLUGIN_NAME = "minecraft_3d_skin_layers";

  // src/plugin.ts
  async function runGeneration(auto) {
    if (!isEditMode()) {
      if (!auto) {
        toast(t("m3sl.toast.edit_mode"), "edit");
      }
      return;
    }
    if (!hasOpenProject()) {
      if (!auto) {
        toast(t("m3sl.toast.open_project"), "info");
      }
      return;
    }
    const options = loadOptions();
    const outcome = scanAndPlan(options);
    if (outcome.snapshots.length === 0) {
      if (!auto) {
        reportNoLayers();
      }
      return;
    }
    if (outcome.voxelCount > options.maxVoxels) {
      reportVoxelLimit(new VoxelLimitError(outcome.voxelCount, options.maxVoxels));
      return;
    }
    if (auto && !options.autoApplyOnLoad) {
      status(t("m3sl.status.detected", [outcome.snapshots.length, outcome.voxelCount]));
      return;
    }
    if (auto) {
      const result2 = await applyOutcome(outcome, options);
      reportGenerationResult({ ...result2, warnings: outcome.warnings });
      return;
    }
    const confirmed = await new Promise((resolve) => {
      showGenerationDialog(
        { layerCount: outcome.snapshots.length, voxelCount: outcome.voxelCount, warnings: outcome.warnings },
        options,
        (merged) => {
          persistOptions(merged);
          resolve(merged);
        },
        () => resolve(null)
      );
    });
    if (!confirmed) {
      return;
    }
    const fresh = scanAndPlan(confirmed);
    if (fresh.snapshots.length === 0) {
      reportNoLayers();
      return;
    }
    if (fresh.voxelCount > confirmed.maxVoxels) {
      reportVoxelLimit(new VoxelLimitError(fresh.voxelCount, confirmed.maxVoxels));
      return;
    }
    const appliedToCopy = confirmed.targetModel === "copy";
    if (appliedToCopy) {
      duplicateCurrentProjectAsCopy(blockbenchDuplicateHost, " - 3D Layers");
    }
    const result = await applyOutcome(fresh, confirmed);
    reportGenerationResult(
      { ...result, warnings: fresh.warnings },
      appliedToCopy ? t("m3sl.toast.copied_note") : void 0
    );
  }
  var running = false;
  async function runGenerationGuarded(auto) {
    if (running) {
      reportBusy();
      return;
    }
    running = true;
    try {
      await runGeneration(auto);
    } catch (error) {
      if (error instanceof VoxelLimitError) {
        reportVoxelLimit(error);
      } else {
        logger.error("generation failed", error);
        reportError(error);
      }
    } finally {
      running = false;
    }
  }
  async function runRestore() {
    if (!isEditMode()) {
      toast(t("m3sl.toast.edit_mode_restore"), "edit");
      return;
    }
    if (!hasOpenProject()) {
      toast(t("m3sl.toast.open_project"), "info");
      return;
    }
    const candidates = collectRestoreCandidates();
    if (candidates.length === 0) {
      reportNoRestorableGroups();
      return;
    }
    const voxelCount = candidates.reduce((sum, candidate) => sum + candidate.children.length, 0);
    const confirmed = await new Promise((resolve) => {
      showRestoreDialog(
        { groupCount: candidates.length, voxelCount },
        loadOptions(),
        (merged) => {
          persistOptions(merged);
          resolve(merged);
        },
        () => resolve(null)
      );
    });
    if (!confirmed) {
      return;
    }
    const appliedToCopy = confirmed.targetModel === "copy";
    if (appliedToCopy) {
      duplicateCurrentProjectAsCopy(blockbenchDuplicateHost, " - Restored");
    }
    const activeCandidates = collectRestoreCandidates();
    if (activeCandidates.length === 0) {
      reportNoRestorableGroups();
      return;
    }
    const result = applyRestores(activeCandidates, blockbenchHost);
    reportRestoreResult(
      result,
      appliedToCopy ? t("m3sl.toast.copied_note") : void 0
    );
  }
  async function runRestoreGuarded() {
    if (running) {
      reportBusy();
      return;
    }
    running = true;
    try {
      await runRestore();
    } catch (error) {
      reportRestoreError(error);
    } finally {
      running = false;
    }
  }
  function runClearTransparent() {
    if (!hasOpenProject()) {
      toast(t("m3sl.toast.open_project"), "info");
      return;
    }
    const options = loadOptions();
    const summary = clearTransparentCubes(blockbenchHost, options.alphaThreshold);
    reportCleared(summary);
  }
  function runClearTransparentGuarded() {
    if (running) {
      reportBusy();
      return;
    }
    running = true;
    try {
      runClearTransparent();
    } catch (error) {
      logger.error("transparent cleanup failed", error);
      reportError(error);
    } finally {
      running = false;
    }
  }
  var actions = [];
  var listeners = [];
  var generatedSourceProperty;
  var skinMenu;
  function onProjectLoaded() {
    return () => {
      if (isAutoScanSuppressed()) {
        return;
      }
      void runGenerationGuarded(true);
    };
  }
  function registerPlugin() {
    registerTranslations();
    generatedSourceProperty = new Property(Group, "object", GENERATED_SOURCE_PROPERTY, {
      default: null,
      export: true,
      copy_value: true
    });
    const generateAction = new Action(`${PLUGIN_ID}.generate`, {
      name: t("m3sl.action.name"),
      description: t("m3sl.action.description"),
      icon: "view_in_ar",
      category: "edit",
      condition: () => isEditMode() && hasOpenProject(),
      click: () => {
        void runGenerationGuarded(false);
      }
    });
    const restoreAction = new Action(`${PLUGIN_ID}.restore`, {
      name: t("m3sl.restore_action.name"),
      description: t("m3sl.restore_action.description"),
      icon: "unarchive",
      category: "edit",
      condition: () => isEditMode() && hasOpenProject() && hasRestorableGroups(),
      click: () => {
        void runRestoreGuarded();
      }
    });
    const clearTransparentAction = new Action(`${PLUGIN_ID}.clear_transparent`, {
      name: t("m3sl.clear_action.name"),
      description: t("m3sl.clear_action.description"),
      icon: "layers_clear",
      category: "edit",
      condition: () => hasOpenProject(),
      click: () => {
        runClearTransparentGuarded();
      }
    });
    actions = [generateAction, restoreAction, clearTransparentAction];
    MenuBar.addAction(generateAction, "edit");
    MenuBar.addAction(restoreAction, "edit");
    skinMenu = new BarMenu(`${PLUGIN_ID}.menu`, [`${PLUGIN_ID}.clear_transparent`], {
      name: "m3sl.menu.name",
      condition: () => hasOpenProject(),
      icon: "view_in_ar"
    });
    MenuBar.addMenu(skinMenu, "file");
    registerNewSkinFormat();
    listeners = [onProjectEvent("load_project", onProjectLoaded())];
  }
  function unregisterPlugin() {
    for (const listener of listeners) {
      listener.dispose();
    }
    listeners = [];
    MenuBar.removeAction(`edit.${PLUGIN_ID}.generate`);
    MenuBar.removeAction(`edit.${PLUGIN_ID}.restore`);
    unregisterNewSkinFormat();
    if (skinMenu && typeof skinMenu.delete === "function") {
      skinMenu.delete();
      MenuBar.update();
    }
    skinMenu = void 0;
    for (const action of actions) {
      action.delete();
    }
    actions = [];
    generatedSourceProperty?.delete();
    generatedSourceProperty = void 0;
  }

  // src/index.ts
  BBPlugin.register(PLUGIN_ID, {
    title: "Minecraft 3D Skin Layers",
    author: "600_liang",
    icon: "view_in_ar",
    description: 'Convert Minecraft skin outer layers ("xxx Layer" cubes) into per-pixel voxel cubes. Every visible texel becomes one cube whose six faces map to that pixel; the layer cube is replaced by a same-named group in one reversible undo step. Generated groups can also be restored to their original single cubes.',
    version: "0.4.0-pre",
    min_version: "5.0.0",
    variant: "desktop",
    tags: ["Minecraft"],
    onload() {
      registerPlugin();
    },
    onunload() {
      unregisterPlugin();
    }
  });
})();
