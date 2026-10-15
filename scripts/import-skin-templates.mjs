// Import the maintained Steve/Alex source files into repository assets.
// Usage: node scripts/import-skin-templates.mjs [path/to/temp_model]
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addRightArmLayer2, prepareTemplateForEmbedding } from './template-assets.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(process.argv[2] ?? join(root, '..', 'temp_model'));
const formatId = 'm3sl_3d_skin';
const sourceTemplates = [
  { skinType: 'steve', id: 'classic', source: 'steve_skins_model.bbmodel' },
  { skinType: 'steve', id: 'root', source: 'steve_skins_model_root.bbmodel' },
  { skinType: 'steve', id: 'joint', source: 'steve_skins_model_root_joint.bbmodel', addOuter: true },
  { skinType: 'alex', id: 'classic', source: 'alex_skins_model.bbmodel' },
  { skinType: 'alex', id: 'root', source: 'alex_skins_model_root.bbmodel' },
  { skinType: 'alex', id: 'joint', source: 'alex_skins_model_root_joint.bbmodel', addOuter: true },
];

for (const skinType of ['steve', 'alex']) {
  mkdirSync(join(root, 'assets', 'templates', skinType), { recursive: true });
  for (const size of [64, 128]) {
    copyFileSync(
      join(sourceRoot, `${skinType}-${size}.png`),
      join(root, 'assets', 'textures', `${skinType}-${size}.png`),
    );
  }
}

for (const entry of sourceTemplates) {
  const inputPath = join(sourceRoot, entry.source);
  const model = JSON.parse(readFileSync(inputPath, 'utf8'));
  if (entry.addOuter && !model.elements?.some(element => element.name === 'Right Arm Layer2')) {
    addRightArmLayer2(model, entry.skinType, entry.source);
  }
  model.meta = model.meta ?? {};
  model.meta.model_format = formatId;
  prepareTemplateForEmbedding(model);
  for (const texture of model.textures ?? []) {
    texture.name = `${entry.skinType}-64.png`;
    texture.width = 64;
    texture.height = 64;
    texture.uv_width = 64;
    texture.uv_height = 64;
  }
  const outputPath = join(root, 'assets', 'templates', entry.skinType, `${entry.id}.bbmodel`);
  writeFileSync(outputPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  console.log(`${entry.source} -> ${outputPath}`);
}
