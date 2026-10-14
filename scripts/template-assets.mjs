import { createHash } from 'node:crypto';

/** Remove saved editor selection state while preserving model content. */
export function stripEditorSelection(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripEditorSelection(item);
    return;
  }
  if (!value || typeof value !== 'object') return;

  delete value.selected;
  delete value.primary_selected;
  if (value.m3sl_source && typeof value.m3sl_source === 'object' && !Object.keys(value.m3sl_source).length) {
    delete value.m3sl_source;
  }
  for (const child of Object.values(value)) stripEditorSelection(child);
}

/** Remove unused texture slots and remap numeric face indices to the compact table. */
export function compactTextureTable(model) {
  const textures = model.textures;
  if (!Array.isArray(textures)) return;

  const used = new Set();
  for (const element of model.elements ?? []) {
    for (const face of Object.values(element.faces ?? {})) {
      if (Number.isInteger(face.texture) && face.texture >= 0) used.add(face.texture);
    }
  }

  if (used.size === 0) return;
  const ordered = [...used].sort((a, b) => a - b);
  const remap = new Map(ordered.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  for (const index of ordered) {
    if (!textures[index]) throw new Error(`Face references missing texture index ${index}`);
  }
  for (const element of model.elements ?? []) {
    for (const face of Object.values(element.faces ?? {})) {
      if (Number.isInteger(face.texture) && face.texture >= 0) {
        face.texture = remap.get(face.texture);
      }
    }
  }
  model.textures = ordered.map((index, newIndex) => {
    const texture = textures[index];
    texture.id = String(newIndex);
    return texture;
  });
}

function deterministicUuid(label) {
  const bytes = createHash('sha256').update(label).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function findOutlinerNode(nodes, uuid) {
  for (const node of nodes ?? []) {
    if (node && typeof node === 'object') {
      if (node.uuid === uuid) return node;
      const nested = findOutlinerNode(node.children, uuid);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Add the missing, segmented right forearm shell to a jointed source model. */
export function addRightArmLayer2(model, skinType, sourceName) {
  const base = model.elements?.find(element => element.name === 'Right Arm2');
  if (!base) throw new Error(`${sourceName}: missing Right Arm2 base cube`);
  if (model.elements.some(element => element.name === 'Right Arm Layer2')) {
    throw new Error(`${sourceName}: Right Arm Layer2 already exists`);
  }

  const parentGroup = model.groups?.find(group => group.name === 'Right Arm2');
  if (!parentGroup) throw new Error(`${sourceName}: missing Right Arm2 group`);
  const parentNode = findOutlinerNode(model.outliner, parentGroup.uuid);
  if (!parentNode || !Array.isArray(parentNode.children)) {
    throw new Error(`${sourceName}: Right Arm2 group is absent from the outliner`);
  }

  const uuid = deterministicUuid(`minecraft-3d-skin-layers:${skinType}:Right Arm Layer2`);
  const existingUuids = new Set([
    ...(model.elements ?? []).map(element => element.uuid),
    ...(model.groups ?? []).map(group => group.uuid),
  ]);
  if (existingUuids.has(uuid)) throw new Error(`${sourceName}: generated cube UUID already exists`);

  const layer = structuredClone(base);
  layer.uuid = uuid;
  layer.name = 'Right Arm Layer2';
  layer.visibility = false;
  layer.inflate = 0.25;
  layer.uv_offset = [base.uv_offset[0], base.uv_offset[1] + 16];
  for (const direction of ['north', 'east', 'south', 'west', 'up', 'down']) {
    const face = layer.faces?.[direction];
    if (!face || !Array.isArray(face.uv) || face.uv.length !== 4) {
      throw new Error(`${sourceName}: Right Arm2 has invalid ${direction} UV`);
    }
    face.uv = [face.uv[0], face.uv[1] + 16, face.uv[2], face.uv[3] + 16];
  }

  const elementIndex = model.elements.indexOf(base);
  model.elements.splice(elementIndex + 1, 0, layer);
  const outlinerIndex = parentNode.children.indexOf(base.uuid);
  if (outlinerIndex < 0) throw new Error(`${sourceName}: Right Arm2 cube is absent from its group`);
  parentNode.children.splice(outlinerIndex + 1, 0, uuid);
}

/** Normalize a model before it is serialized into the plugin bundle. */
export function prepareTemplateForEmbedding(model) {
  stripEditorSelection(model);
  compactTextureTable(model);
  for (const texture of model.textures ?? []) {
    delete texture.source;
    delete texture.relative_path;
  }
  return model;
}
