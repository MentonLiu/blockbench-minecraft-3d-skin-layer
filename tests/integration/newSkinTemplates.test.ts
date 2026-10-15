import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/domain/constants';
import { buildVoxelPlans, countPlanVoxels } from '../../src/geometry/voxelPlanner';
import { buildTemplateModel, type SkinSize, type SkinType, type TemplateId } from '../../src/newSkin/templates';
import { loadModelData, type FixtureModel } from '../helpers/referenceModel';

const combinations = (['steve', 'alex'] as const).flatMap(skinType =>
  (['root', 'classic', 'joint'] as const).flatMap(template =>
    ([64, 128] as const).map(size => ({ skinType, template, size })),
  ),
);

const JOINT_GOLDENS: Record<string, { visible: number; full: number }> = {
  'steve/64': { visible: 622, full: 1848 },
  'steve/128': { visible: 3999, full: 7392 },
  'alex/64': { visible: 648, full: 1744 },
  'alex/128': { visible: 2762, full: 6976 },
};

function loadTemplate(skinType: SkinType, template: TemplateId, size: SkinSize) {
  const { model } = buildTemplateModel(skinType, template, size);
  return loadModelData(model as unknown as FixtureModel['raw']);
}

function findOutlinerNode(nodes: unknown[], uuid: string): Record<string, unknown> | undefined {
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (node.uuid === uuid) return node;
    const children = Array.isArray(node.children) ? node.children : [];
    const match = findOutlinerNode(children, uuid);
    if (match) return match;
  }
  return undefined;
}

describe('Steve/Alex embedded skin templates', () => {
  it.each(combinations)('$skinType $template $size is ready to voxelize', ({ skinType, template, size }) => {
    const model = loadTemplate(skinType, template, size);
    const built = model.raw;
    const texture = built.textures[0];
    const plan = buildVoxelPlans(model.snapshots, model.textures, DEFAULT_OPTIONS);
    const full = buildVoxelPlans(model.snapshots, model.textures, {
      ...DEFAULT_OPTIONS,
      includeTransparent: true,
    });

    expect(plan.warnings).toEqual([]);
    expect(full.warnings).toEqual([]);
    expect(model.snapshots.length).toBeGreaterThan(0);
    expect(texture.name).toBe(`${skinType}-${size}.png`);
    expect(texture.id).toBe('0');
    expect(texture.width).toBe(size);
    expect(texture.height).toBe(size);
    expect(texture.uv_width).toBe(64);
    expect(texture.uv_height).toBe(64);
    expect(model.textures.size).toBe(1);
    expect(countPlanVoxels(full.plans)).toBeLessThanOrEqual(10_000);

    for (const element of built.elements) {
      for (const face of Object.values(element.faces)) {
        expect(face.texture).toBe(0);
      }
    }

    if (template === 'joint') {
      const golden = JOINT_GOLDENS[`${skinType}/${size}`];
      expect(countPlanVoxels(plan.plans)).toBe(golden.visible);
      expect(countPlanVoxels(full.plans)).toBe(golden.full);
    }
  });

  it.each(['steve', 'alex'] as const)('$skinType joint includes a right forearm outer cube in the animated bone', skinType => {
    const model = loadTemplate(skinType, 'joint', 64);
    const base = model.raw.elements.find(element => element.name === 'Right Arm2')!;
    const layer = model.raw.elements.find(element => element.name === 'Right Arm Layer2')!;
    const armGroup = model.raw.groups.find(group => group.name === 'Right Arm2')!;
    const outlinerNode = findOutlinerNode(model.raw.outliner, armGroup.uuid)!;

    expect(model.raw.elements).toHaveLength(22);
    expect(model.snapshots).toHaveLength(11);
    expect(new Set(model.raw.elements.map(element => element.uuid)).size).toBe(22);
    expect(new Set([
      ...model.raw.elements.map(element => element.uuid),
      ...model.raw.groups.map(group => group.uuid),
    ]).size).toBe(model.raw.elements.length + model.raw.groups.length);
    expect(layer.uuid).not.toBe(base.uuid);
    // Authored shells may use independent bounds and cap UVs; preserve the asset.
    const source = JSON.parse(readFileSync(new URL(
      `../../assets/templates/${skinType}/joint.bbmodel`, import.meta.url,
    ), 'utf8'));
    const authoredLayer = source.elements.find((element: { name: string }) => element.name === 'Right Arm Layer2');
    expect(layer).toEqual(authoredLayer);
    expect(layer.box_uv).toBe(false);
    expect(layer.inflate).toBe(0.25);
    expect(outlinerNode.children).toEqual([base.uuid, layer.uuid]);
    expect(model.raw.animations).toHaveLength(1);
    expect(model.raw.animations![0].animators![armGroup.uuid]).toBeDefined();
  });
});
