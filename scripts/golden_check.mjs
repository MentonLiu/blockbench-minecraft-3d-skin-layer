// Temporary golden-number verification against the plan (880 visible texels).
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const model = JSON.parse(readFileSync('../../skin_model.bbmodel', 'utf8'));
const dataUrl = model.textures[0].source;
const png = PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
console.log('texture', png.width, 'x', png.height, 'uv', model.textures[0].uv_width, model.textures[0].uv_height);

// compare with steve64.png on disk
const disk = PNG.sync.read(readFileSync('../../steve64.png'));
const sameSize = disk.width === png.width && disk.height === png.height;
let same = sameSize;
if (sameSize) {
  for (let i = 0; i < png.data.length; i += 4) {
    const j = i;
    for (let k = 0; k < 4; k++) {
      if (png.data[j + k] !== disk.data[j + k]) { same = false; break; }
    }
    if (!same) break;
  }
}
console.log('embedded == steve64.png on disk:', same);

const uvW = model.textures[0].uv_width, uvH = model.textures[0].uv_height;
const sx = png.width / uvW, sy = png.height / uvH;
const alpha = (x, y) => png.data[(y * png.width + x) * 4 + 3];

let total = 0;
for (const el of model.elements) {
  if (!/\sLayer$/i.test(el.name)) continue;
  let layerTotal = 0;
  const perFace = [];
  for (const [dir, face] of Object.entries(el.faces)) {
    const [u1, v1, u2, v2] = face.uv;
    const nu = Math.round(Math.abs(u2 - u1) * sx);
    const nv = Math.round(Math.abs(v2 - v1) * sy);
    const x0 = Math.floor(Math.min(u1, u2) * sx);
    const y0 = Math.floor(Math.min(v1, v2) * sy);
    let visible = 0;
    for (let py = y0; py < y0 + nv; py++) {
      for (let px = x0; px < x0 + nu; px++) {
        if (alpha(px, py) > 0) visible++;
      }
    }
    perFace.push(`${dir}:${nu}x${nv}=${visible}`);
    layerTotal += visible;
  }
  total += layerTotal;
  console.log(el.name.padEnd(18), layerTotal, '  ', perFace.join(' '));
}
console.log('TOTAL', total);
