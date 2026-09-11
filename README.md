# Minecraft 3D Skin Layers

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v0.2.1-blue.svg)](../../releases)
[![Blockbench](https://img.shields.io/badge/Blockbench-5.0%2B-orange)](https://blockbench.net)

English | [简体中文](README.zh-CN.md)

A Blockbench plugin that converts Minecraft skin outer layers into **per-pixel
voxel cubes**: every visible texel of a `* Layer` cube becomes one full cube
whose six faces all map to that exact pixel. The layer cube is replaced by a
same-named group in a single reversible undo step.

Works on any Minecraft-format or generic model that uses the usual
`Hat Layer`, `Body Layer`, `Right/Left Arm Layer`, `Right/Left Leg Layer`
naming - the existing layer cube's geometry and UVs are the source of truth,
so 64x64, 128x128 and custom UV layouts all work without any hard-coded skin
atlas.

![Generated voxel layers in Blockbench](docs/images/preview.png)

## Highlights

- **One cube per pixel** - nothing hidden, all six faces of every voxel
  enabled and mapped to the same source pixel.
- **No z-fighting inside a part** - each face direction's shell carries a
  tiny per-direction offset (max 0.0075, invisible), so faces of different
  directions never share a plane. Verified by exact rectangle-overlap
  analysis on the reference model.
- **True to the original layer** - thickness matches the layer inflate, so
  the voxel shell reproduces the original layer contour.
- **Cross-part overlaps stay as-is** - parts that interpenetrate in the
  default pose (legs, waist) keep their shared planes; pose the model and
  they separate.
- **Resolution-independent** - UV-to-texel math is derived from the actual
  texture and project UV size; 128x128 skins produce 2x grids with no
  special-casing.
- **Safe & idempotent** - one atomic undo transaction per run with rollback
  on failure; second runs are no-ops; preflight aborts above the configured
  cube limit before anything is modified.
- **English & 简体中文** UI via Blockbench's translation system.

## Installation

1. Download `minecraft_3d_skin_layers.js` from the
   [latest release](../../releases) - or build it yourself (`npm run build`).
2. In Blockbench: **File > Plugins > ... (gear icon) > Load Plugin from
   File**, or copy the file into Blockbench's `plugins` folder.
3. Requires Blockbench **5.0.0+** (desktop variant).

## Usage

1. Open your skin model in **Edit** mode.
2. Run **Edit > Generate 3D Skin Layers**.
3. The preflight dialog reports how many layer cubes and visible texels were
   found. Adjust the options and confirm.

### Options

| Option | Default | Meaning |
|---|---|---|
| Alpha threshold | 0 | texels with alpha above this become cubes (0 = every non-transparent pixel) |
| Maximum cube count | 10,000 | preflight aborts above this; nothing is modified |
| Batch size | 200 | cubes created per UI batch |
| Keep original layer cubes | off | hides the sources instead of deleting them |
| Replace fully transparent layers | off | replaces empty layers with empty groups |
| Only selected layers | off | processes only selected layer cubes |
| Auto-generate on project load | off | runs generation when a project opens |

### Behavior

- **Every non-transparent texel becomes one full voxel** with all six faces
  enabled - nothing is hidden or skipped.
- **Per-face UV**: all six faces of a voxel map to the same source pixel.
- **No z-fighting within a part**: each face direction's grid carries a tiny
  epsilon (0 to 0.0075) so faces of different directions never share a
  plane; a 0.001 standoff keeps voxel inner faces off the base cube.
- Different parts that interpenetrate in the default pose (e.g. the legs)
  keep their shared plane on purpose - pose the model and they separate.
- **Idempotent**: only `Cube` elements named `... Layer` are scanned;
  generated groups are never re-processed, so a second run is a no-op.
- **Atomic**: the whole run is one undo transaction; failures roll back.
- Multi-texture models are supported per-face; each face uses its own
  texture. Reversed UV rects and face rotation (0/90/180/270) are honored.

### Known limitations

- Edges/corners: the inflated ring of the original layer is covered by the
  neighbouring faces' voxels, but a hairline seam can remain visible at
  extreme grazing angles.
- Parts that interpenetrate in the default pose shimmer against each other
  on their shared plane (accepted; disappears when posed).
- Desktop variant only for now; web is untested.
- No regeneration workflow yet: re-voxelizing requires undoing to the
  original layer cubes first.
- No greedy merging by design: one pixel = one cube is the core contract.

## Development

```bash
npm install
npm run check      # typecheck + tests + build
npm run test:watch # vitest watch mode
```

- `docs/SPEC.md` - behavioral contract and defaults
- `docs/ARCHITECTURE.md` - module map, data flow, WriterHost seam
- `docs/UV_MAPPING.md` - the exact UV/geometry math (ported from Blockbench)
- `docs/TEST_PLAN.md` - test matrix and manual acceptance steps

The `tests/fixtures/skin_model.bbmodel` fixture is the reference model: a
64x64 skin whose six layer cubes voxelize into exactly **880 cubes**
(golden test), verified live in Blockbench 5.1.6.

### Contributing

Issues and pull requests are welcome. Please run `npm run check` before
submitting a PR and keep commits following
[Conventional Commits](https://www.conventionalcommits.org).

## License

Released under the [MIT License](LICENSE).
