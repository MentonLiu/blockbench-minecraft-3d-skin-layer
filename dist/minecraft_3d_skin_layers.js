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
    const t = box.inflated.to;
    const width = t[0] - f[0];
    const height = t[1] - f[1];
    const depth = t[2] - f[2];
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
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function facePoint(direction, box, mx, my) {
    const f = box.inflated.from;
    const t = box.inflated.to;
    switch (direction) {
      case "north":
        return [lerp(t[0], f[0], mx), lerp(t[1], f[1], my), f[2]];
      case "south":
        return [lerp(f[0], t[0], mx), lerp(t[1], f[1], my), t[2]];
      case "east":
        return [t[0], lerp(t[1], f[1], my), lerp(t[2], f[2], mx)];
      case "west":
        return [f[0], lerp(t[1], f[1], my), lerp(f[2], t[2], mx)];
      case "up":
        return [lerp(f[0], t[0], mx), t[1], lerp(f[2], t[2], my)];
      case "down":
        return [lerp(f[0], t[0], mx), f[1], lerp(t[2], f[2], my)];
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
            face: direction
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
    const make = () => ({
      texture: texture ? texture.uuid : false,
      uv: [uv[0], uv[1], uv[2], uv[3]],
      rotation: 0
    });
    const faces = {};
    for (const direction of FACE_DIRECTIONS) {
      faces[direction] = make();
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

Warnings:
- ${summary.warnings.slice(0, 5).join("\n- ")}` + (summary.warnings.length > 5 ? `
- ... ${summary.warnings.length - 5} more` : "") : "";
    new Dialog({
      id: `${PLUGIN_ID}.generate_dialog`,
      title: "Generate 3D Skin Layers",
      width: 512,
      form: {
        intro: {
          type: "text",
          text: `Found **${summary.layerCount}** layer cube(s) with **${summary.voxelCount}** visible texel(s). Each texel becomes one cube whose six faces map to that pixel.${warningText}`
        },
        depthMode: {
          label: "Voxel depth",
          type: "select",
          value: options.depthMode,
          options: {
            preserve_layer: "Match layer inflate (preserves contour)",
            pixel: "Match texel size (strong voxel look)",
            fixed: "Fixed thickness"
          }
        },
        fixedDepth: {
          label: "Fixed thickness (only used in fixed mode)",
          type: "number",
          value: options.fixedDepth,
          min: 0.01,
          max: 16,
          step: 0.05
        },
        alphaThreshold: {
          label: "Alpha threshold (texels with alpha above this become cubes)",
          type: "number",
          value: options.alphaThreshold,
          min: 0,
          max: 255,
          step: 1,
          force_step: true
        },
        maxVoxels: {
          label: "Maximum cube count (run aborts above this)",
          type: "number",
          value: options.maxVoxels,
          min: 1,
          max: 1e6,
          step: 100,
          force_step: true
        },
        batchSize: {
          label: "Cubes created per batch",
          type: "number",
          value: options.batchSize,
          min: 10,
          max: 5e3,
          step: 10,
          force_step: true
        },
        preserveOriginal: {
          label: "Keep original layer cubes (hide instead of delete)",
          type: "checkbox",
          value: options.preserveOriginal
        },
        replaceEmptyLayer: {
          label: "Replace fully transparent layers with empty groups",
          type: "checkbox",
          value: options.replaceEmptyLayer
        },
        processSelectedOnly: {
          label: "Only process selected layer cubes",
          type: "checkbox",
          value: options.processSelectedOnly
        },
        autoApplyOnLoad: {
          label: "Generate automatically when a project loads",
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
    toast('No "* Layer" cubes found - model left unchanged', "info");
  }
  function reportBusy() {
    toast("A generation run is already in progress", "hourglass_empty");
  }
  function reportVoxelLimit(error) {
    toast(
      `Aborted: run needs ${error.voxelCount} cubes, maxVoxels is ${error.limit}. Raise the limit in the settings dialog if you really want this.`,
      "warning"
    );
  }
  function reportGenerationResult(result) {
    const seconds = (result.durationMs / 1e3).toFixed(2);
    toast(
      `Generated ${result.createdCubes} cubes in ${result.createdGroups} layer group(s) (${seconds}s)` + (result.warnings.length ? ` - ${result.warnings.length} warning(s), see console` : ""),
      "view_in_ar"
    );
    for (const warning of result.warnings) {
      console.warn(`[minecraft_3d_skin_layers] ${warning}`);
    }
  }
  function reportError(error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[minecraft_3d_skin_layers] generation failed:", error);
    toast(`Generation failed: ${message}`, "error");
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
        toast("Switch to Edit mode to generate 3D skin layers", "edit");
      }
      return;
    }
    if (!hasOpenProject()) {
      if (!auto) {
        toast("Open a project first", "info");
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
      status(
        `${outcome.snapshots.length} skin layer cube(s) with ${outcome.voxelCount} texels detected - use "Generate 3D Skin Layers" to voxelize`
      );
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
    actions = [
      new Action(`${PLUGIN_ID}.generate`, {
        name: "Generate 3D Skin Layers",
        description: 'Replace "* Layer" cubes with per-pixel voxel cubes',
        icon: "view_in_ar",
        category: "edit",
        condition: () => isEditMode() && hasOpenProject(),
        click: () => {
          void runGenerationGuarded(false);
        }
      })
    ];
    listeners = [onProjectEvent("load_project", onProjectLoaded())];
  }
  function unregisterPlugin() {
    for (const listener of listeners) {
      listener.dispose();
    }
    listeners = [];
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
    version: "0.1.0",
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
