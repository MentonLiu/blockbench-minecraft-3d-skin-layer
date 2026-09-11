"use strict";
(() => {
  // src/domain/constants.ts
  var PLUGIN_ID = "minecraft_3d_skin_layers";
  var LAYER_NAME_RE = /\sLayer$/i;
  var FACE_DIRECTIONS = ["north", "east", "south", "west", "up", "down"];
  var DEFAULT_OPTIONS = {
    alphaThreshold: 0,
    maxVoxels: 1e4,
    batchSize: 200,
    depthMode: "preserve_layer",
    fixedDepth: 0.25,
    preserveOriginal: false,
    replaceEmptyLayer: false,
    autoApplyOnLoad: false,
    processSelectedOnly: false,
    useUVToLocalWhenAvailable: false
  };
  var TEXEL_EPSILON = 0.01;
  var MIN_DEPTH = 0.01;

  // src/domain/types.ts
  var VoxelLimitError = class extends Error {
    constructor(voxelCount, limit) {
      super(`Voxel plan needs ${voxelCount} cubes which exceeds maxVoxels (${limit}).`);
      this.voxelCount = voxelCount;
      this.limit = limit;
      this.name = "VoxelLimitError";
    }
  };

  // src/geometry/depthStrategy.ts
  function resolveDepth(mode, inflate, texel, options) {
    let depth;
    switch (mode) {
      case "preserve_layer":
        depth = inflate > 0 ? inflate : (texel.u + texel.v) / 2;
        break;
      case "pixel":
        depth = (texel.u + texel.v) / 2;
        break;
      case "fixed":
        depth = options.fixedDepth;
        break;
    }
    return Math.max(depth, MIN_DEPTH);
  }

  // src/geometry/faceMapper.ts
  var OPPOSITE_FACE = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
    up: "down",
    down: "up"
  };
  function resolveDisabledFaces(direction, depthMatchesShell) {
    if (depthMatchesShell) {
      return FACE_DIRECTIONS.filter((face) => face !== direction);
    }
    return [OPPOSITE_FACE[direction]];
  }
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
    return { raw: { from: [...from], to: [...to] }, inflated: { from: inflatedFrom, to: inflatedTo } };
  }
  function faceSpans(direction, box) {
    const f = box.inflated.from;
    const t2 = box.inflated.to;
    const width = t2[0] - f[0];
    const height = t2[1] - f[1];
    const depth = t2[2] - f[2];
    switch (direction) {
      case "north":
      case "south":
        return { uSpan: width, vSpan: height };
      case "east":
      case "west":
        return { uSpan: depth, vSpan: height };
      case "up":
      case "down":
        return { uSpan: width, vSpan: depth };
    }
  }
  function lerp(a, b, t2) {
    return a + (b - a) * t2;
  }
  function facePoint(direction, box, mx, my) {
    const f = box.inflated.from;
    const t2 = box.inflated.to;
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
  function voxelBounds(direction, box, mx0, mx1, my0, my1, depth) {
    const a = facePoint(direction, box, mx0, my0);
    const b = facePoint(direction, box, mx1, my1);
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    const minZ = Math.min(a[2], b[2]);
    const maxZ = Math.max(a[2], b[2]);
    switch (direction) {
      case "north":
        return { from: [minX, minY, box.raw.from[2] - depth], to: [maxX, maxY, box.raw.from[2]] };
      case "south":
        return { from: [minX, minY, box.raw.to[2]], to: [maxX, maxY, box.raw.to[2] + depth] };
      case "east":
        return { from: [box.raw.to[0], minY, minZ], to: [box.raw.to[0] + depth, maxY, maxZ] };
      case "west":
        return { from: [box.raw.from[0] - depth, minY, minZ], to: [box.raw.from[0], maxY, maxZ] };
      case "up":
        return { from: [minX, box.raw.to[1], minZ], to: [maxX, box.raw.to[1] + depth, maxZ] };
      case "down":
        return { from: [minX, box.raw.from[1] - depth, minZ], to: [maxX, box.raw.from[1], maxZ] };
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
  function enumerateVisibleTexels(face, texture, alphaThreshold) {
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
        if (alpha > alphaThreshold) {
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
  var FACE_AXES = {
    north: { axis: 2, u: 0, v: 1, normal: -1 },
    south: { axis: 2, u: 0, v: 1, normal: 1 },
    west: { axis: 0, u: 2, v: 1, normal: -1 },
    east: { axis: 0, u: 2, v: 1, normal: 1 },
    down: { axis: 1, u: 0, v: 2, normal: -1 },
    up: { axis: 1, u: 0, v: 2, normal: 1 }
  };
  function faceRecord(plan, voxel, face) {
    const { axis, u, v, normal } = FACE_AXES[face];
    return {
      plan,
      voxel,
      face,
      axis,
      normal,
      coord: normal < 0 ? voxel.from[axis] : voxel.to[axis],
      u0: voxel.from[u],
      u1: voxel.to[u],
      v0: voxel.from[v],
      v1: voxel.to[v]
    };
  }
  function dedupeCoplanarFaces(plans) {
    const buckets = /* @__PURE__ */ new Map();
    for (const plan of plans) {
      for (const voxel of plan.voxels) {
        for (const face of FACE_DIRECTIONS) {
          if (voxel.disabledFaces.includes(face)) {
            continue;
          }
          const record = faceRecord(plan, voxel, face);
          const key = `${record.axis}:${Math.round(record.coord * 1e4) / 1e4}:${record.normal}`;
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.push(record);
          } else {
            buckets.set(key, [record]);
          }
        }
      }
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) {
        continue;
      }
      bucket.sort(
        (a, b) => a.u0 - b.u0 || a.v0 - b.v0 || (a.plan.sourceName + a.voxel.name).localeCompare(b.plan.sourceName + b.voxel.name)
      );
      const accepted = [];
      for (const record of bucket) {
        const overlaps = accepted.some(
          (kept) => Math.min(kept.u1, record.u1) - Math.max(kept.u0, record.u0) > 1e-6 && Math.min(kept.v1, record.v1) - Math.max(kept.v0, record.v0) > 1e-6
        );
        if (overlaps) {
          record.voxel.disabledFaces.push(record.face);
        } else {
          accepted.push(record);
        }
      }
    }
  }
  function countPlanVoxels(plans) {
    return plans.reduce((sum, plan) => sum + plan.voxels.length, 0);
  }
  function snapshotFace(layer, direction) {
    return layer.faces.find((face) => face.direction === direction);
  }
  function buildVoxelPlans(layers, textures, options) {
    const warnings = [];
    const plans = [];
    for (const layer of layers) {
      if (layer.to[0] <= layer.from[0] || layer.to[1] <= layer.from[1] || layer.to[2] <= layer.from[2]) {
        warnings.push(`${layer.name}: cube has non-positive size, skipped`);
        continue;
      }
      const box = adjustedBox(layer.from, layer.to, layer.inflate, layer.stretch);
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
        const scan = enumerateVisibleTexels(face, texture, options.alphaThreshold);
        warnings.push(...scan.warnings.map((warning) => `${layer.name}/${warning}`));
        if (scan.cells.length === 0) {
          continue;
        }
        const spans = faceSpans(direction, box);
        const grid = { cols: scan.cells[0].cols, rows: scan.cells[0].rows };
        const texel = { u: spans.uSpan / grid.cols, v: spans.vSpan / grid.rows };
        const depth = resolveDepth(options.depthMode, layer.inflate, texel, options);
        const depthMatchesShell = Math.abs(depth - layer.inflate) <= 1e-4;
        for (const cell of scan.cells) {
          const bounds = voxelBounds(
            direction,
            box,
            cell.col / cell.cols,
            (cell.col + 1) / cell.cols,
            cell.row / cell.rows,
            (cell.row + 1) / cell.rows,
            depth
          );
          voxels.push({
            name: `px_${direction}_${cell.col}_${cell.row}`,
            from: bounds.from,
            to: bounds.to,
            origin: [...layer.origin],
            rotation: [...layer.rotation],
            textureKey: face.textureKey,
            pixelUV: cell.pixelUV,
            face: direction,
            disabledFaces: resolveDisabledFaces(direction, depthMatchesShell)
          });
        }
      }
      const isEmpty = voxels.length === 0;
      if (isEmpty && !options.replaceEmptyLayer) {
        continue;
      }
      plans.push({
        sourceKey: layer.key,
        sourceName: layer.name,
        origin: [...layer.origin],
        voxels,
        visiblePixelCount: voxels.length,
        visibility: layer.visibility
      });
    }
    dedupeCoplanarFaces(plans);
    return { plans, warnings };
  }

  // src/i18n/strings.ts
  var en = {
    "m3sl.action.name": "Generate 3D Skin Layers",
    "m3sl.action.description": 'Replace "* Layer" cubes with per-pixel voxel cubes',
    "m3sl.dialog.title": "Generate 3D Skin Layers",
    "m3sl.dialog.intro": "Found **%0** layer cube(s) with **%1** visible texel(s). Each texel becomes one cube whose six faces map to that pixel.",
    "m3sl.dialog.warnings_header": "Warnings:",
    "m3sl.dialog.warnings_more": "... %0 more",
    "m3sl.form.depth_mode": "Voxel depth",
    "m3sl.form.depth_mode.preserve_layer": "Match layer inflate (preserves contour)",
    "m3sl.form.depth_mode.pixel": "Match texel size (strong voxel look)",
    "m3sl.form.depth_mode.fixed": "Fixed thickness",
    "m3sl.form.fixed_depth": "Fixed thickness (only used in fixed mode)",
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
    "m3sl.toast.busy": "A generation run is already in progress",
    "m3sl.toast.limit": "Aborted: run needs %0 cubes, maxVoxels is %1. Raise the limit in the settings dialog if you really want this.",
    "m3sl.toast.edit_mode": "Switch to Edit mode to generate 3D skin layers",
    "m3sl.toast.open_project": "Open a project first",
    "m3sl.toast.failed": "Generation failed: %0",
    "m3sl.status.detected": '%0 skin layer cube(s) with %1 texels detected - use "Generate 3D Skin Layers" to voxelize'
  };
  var zh = {
    "m3sl.action.name": "\u751F\u6210 3D \u76AE\u80A4\u5C42",
    "m3sl.action.description": '\u5C06 "* Layer" \u7ACB\u65B9\u4F53\u66FF\u6362\u4E3A\u9010\u50CF\u7D20\u4F53\u7D20\u65B9\u5757',
    "m3sl.dialog.title": "\u751F\u6210 3D \u76AE\u80A4\u5C42",
    "m3sl.dialog.intro": "\u627E\u5230 **%0** \u4E2A\u76AE\u80A4\u5C42\u7ACB\u65B9\u4F53\uFF0C\u5171 **%1** \u4E2A\u53EF\u89C1\u50CF\u7D20\u3002\u6BCF\u4E2A\u50CF\u7D20\u4F1A\u751F\u6210\u4E00\u4E2A\u516D\u9762\u90FD\u6620\u5C04\u5230\u8BE5\u50CF\u7D20\u7684\u65B9\u5757\u3002",
    "m3sl.dialog.warnings_header": "\u8B66\u544A\uFF1A",
    "m3sl.dialog.warnings_more": "\u2026\u2026\u53E6\u6709 %0 \u6761",
    "m3sl.form.depth_mode": "\u4F53\u7D20\u539A\u5EA6",
    "m3sl.form.depth_mode.preserve_layer": "\u5339\u914D\u5C42\u7684\u81A8\u80C0\u503C\uFF08\u4FDD\u6301\u539F\u59CB\u5916\u8F6E\u5ED3\uFF09",
    "m3sl.form.depth_mode.pixel": "\u5339\u914D\u50CF\u7D20\u5C3A\u5BF8\uFF08\u66F4\u5F3A\u7684\u4F53\u7D20\u7ACB\u4F53\u611F\uFF09",
    "m3sl.form.depth_mode.fixed": "\u56FA\u5B9A\u539A\u5EA6",
    "m3sl.form.fixed_depth": "\u56FA\u5B9A\u539A\u5EA6\uFF08\u4EC5\u5728\u56FA\u5B9A\u539A\u5EA6\u6A21\u5F0F\u4E0B\u4F7F\u7528\uFF09",
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
    "m3sl.toast.busy": "\u5DF2\u6709\u4E00\u6B21\u751F\u6210\u6B63\u5728\u8FDB\u884C\u4E2D",
    "m3sl.toast.limit": "\u5DF2\u4E2D\u6B62\uFF1A\u672C\u6B21\u9700\u8981 %0 \u4E2A\u65B9\u5757\uFF0C\u8D85\u51FA\u4E0A\u9650 %1\u3002\u5982\u786E\u6709\u9700\u8981\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u5BF9\u8BDD\u6846\u4E2D\u8C03\u9AD8\u4E0A\u9650\u3002",
    "m3sl.toast.edit_mode": "\u8BF7\u5148\u5207\u6362\u5230\u7F16\u8F91\u6A21\u5F0F\u518D\u751F\u6210 3D \u76AE\u80A4\u5C42",
    "m3sl.toast.open_project": "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u9879\u76EE",
    "m3sl.toast.failed": "\u751F\u6210\u5931\u8D25\uFF1A%0",
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
        // a face with texture === null does not exist for rendering
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
      faces
    };
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
          visibility: plan.visibility
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
    const make = (disabled) => ({
      texture: disabled ? null : texture ? texture.uuid : false,
      uv: [uv[0], uv[1], uv[2], uv[3]],
      rotation: 0
    });
    const faces = {};
    for (const direction of FACE_DIRECTIONS) {
      faces[direction] = make(spec.disabledFaces.includes(direction));
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

  // src/ui/settingsDialog.ts
  var STORAGE_KEY = `${PLUGIN_ID}.options`;
  var DEPTH_MODES = ["preserve_layer", "pixel", "fixed"];
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
  function sanitizeOptions(raw) {
    const source = typeof raw === "object" && raw !== null ? raw : {};
    const depthMode = DEPTH_MODES.includes(source.depthMode) ? source.depthMode : DEFAULT_OPTIONS.depthMode;
    return {
      alphaThreshold: Math.round(toNumber(source.alphaThreshold, DEFAULT_OPTIONS.alphaThreshold, 0, 255)),
      maxVoxels: Math.round(toNumber(source.maxVoxels, DEFAULT_OPTIONS.maxVoxels, 1, 1e6)),
      batchSize: Math.round(toNumber(source.batchSize, DEFAULT_OPTIONS.batchSize, 10, 5e3)),
      depthMode,
      fixedDepth: toNumber(source.fixedDepth, DEFAULT_OPTIONS.fixedDepth, 0.01, 16),
      preserveOriginal: toBool(source.preserveOriginal, DEFAULT_OPTIONS.preserveOriginal),
      replaceEmptyLayer: toBool(source.replaceEmptyLayer, DEFAULT_OPTIONS.replaceEmptyLayer),
      autoApplyOnLoad: toBool(source.autoApplyOnLoad, DEFAULT_OPTIONS.autoApplyOnLoad),
      processSelectedOnly: toBool(source.processSelectedOnly, DEFAULT_OPTIONS.processSelectedOnly),
      useUVToLocalWhenAvailable: toBool(
        source.useUVToLocalWhenAvailable,
        DEFAULT_OPTIONS.useUVToLocalWhenAvailable
      )
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
        depthMode: {
          label: t("m3sl.form.depth_mode"),
          type: "select",
          value: options.depthMode,
          options: {
            preserve_layer: t("m3sl.form.depth_mode.preserve_layer"),
            pixel: t("m3sl.form.depth_mode.pixel"),
            fixed: t("m3sl.form.depth_mode.fixed")
          }
        },
        fixedDepth: {
          label: t("m3sl.form.fixed_depth"),
          type: "number",
          value: options.fixedDepth,
          min: 0.01,
          max: 16,
          step: 0.05
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
        }
      },
      onConfirm(formResult) {
        onConfirm(sanitizeOptions({ ...options, ...formResult }));
      },
      onClose() {
        onCancel();
      }
    }).show();
  }

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
  function reportBusy() {
    toast(t("m3sl.toast.busy"), "hourglass_empty");
  }
  function reportVoxelLimit(error) {
    toast(t("m3sl.toast.limit", [error.voxelCount, error.limit]), "warning");
  }
  function reportGenerationResult(result) {
    const seconds = (result.durationMs / 1e3).toFixed(2);
    toast(
      t("m3sl.toast.generated", [result.createdCubes, result.createdGroups, seconds]) + (result.warnings.length ? " " + t("m3sl.toast.warnings", [result.warnings.length]) : ""),
      "view_in_ar"
    );
    for (const warning of result.warnings) {
      console.warn(`[minecraft_3d_skin_layers] ${warning}`);
    }
  }
  function reportError(error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[minecraft_3d_skin_layers] generation failed:", error);
    toast(t("m3sl.toast.failed", [message]), "error");
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
    const result = await applyOutcome(outcome, confirmed);
    reportGenerationResult({ ...result, warnings: outcome.warnings });
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
  var actions = [];
  var listeners = [];
  function onProjectLoaded() {
    return () => {
      void runGenerationGuarded(true);
    };
  }
  function registerPlugin() {
    registerTranslations();
    const action = new Action(`${PLUGIN_ID}.generate`, {
      name: t("m3sl.action.name"),
      description: t("m3sl.action.description"),
      icon: "view_in_ar",
      category: "edit",
      condition: () => isEditMode() && hasOpenProject(),
      click: () => {
        void runGenerationGuarded(false);
      }
    });
    actions = [action];
    MenuBar.addAction(action, "edit");
    listeners = [onProjectEvent("load_project", onProjectLoaded())];
  }
  function unregisterPlugin() {
    for (const listener of listeners) {
      listener.dispose();
    }
    listeners = [];
    MenuBar.removeAction(`edit.${PLUGIN_ID}.generate`);
    for (const action of actions) {
      action.delete();
    }
    actions = [];
  }

  // src/index.ts
  BBPlugin.register(PLUGIN_ID, {
    title: "Minecraft 3D Skin Layers",
    author: "bbmodel-skins",
    icon: "view_in_ar",
    description: 'Convert Minecraft skin outer layers ("xxx Layer" cubes) into per-pixel voxel cubes. Every visible texel becomes one cube whose six faces map to that pixel; the layer cube is replaced by a same-named group in one reversible undo step.',
    version: "0.2.0",
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
