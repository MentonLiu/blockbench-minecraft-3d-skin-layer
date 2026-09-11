# Minecraft 3D Skin Layers

A Blockbench plugin that converts Minecraft skin outer layers into **per-pixel
voxel cubes**: every visible texel of a `* Layer` cube becomes one cube whose
six faces all map to that exact pixel. The layer cube is replaced by a
same-named group in a single reversible undo step.

Works on any Minecraft-format or generic model that uses the usual `Hat Layer`,
`Body Layer`, `Right/Left Arm Layer`, `Right/Left Leg Layer` naming - the
existing layer cube's geometry and UVs are the source of truth, so 64x64,
128x128 and custom UV layouts all work without any hard-coded skin atlas.

## Installation

1. Build or download the bundle (`dist/minecraft_3d_skin_layers.js`).
2. In Blockbench: **File > Plugins > ... (gear icon) > Load Plugin from File**,
   or copy the file into Blockbench's plugins folder.
3. Requires Blockbench **5.0.0+** (desktop variant).

## Usage

1. Open your skin model in **Edit** mode.
2. Run **Edit > Generate 3D Skin Layers** (toolbar category "edit").
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

- **Every non-transparent texel becomes one full 1x1x1-texel cube** with all
  six faces enabled - nothing is hidden or skipped.
- **Box UV** (`box_uv: true`), like the source model: each voxel's `uv_offset`
  is chosen so its shell face samples exactly its own pixel; the side faces
  follow the box unwrap.
- **No z-fighting within a part**: each face direction tiles its own raw box
  face, so the slabs never overlap, and a 0.001 standoff keeps voxel inner
  faces off the base cube. Different parts that interpenetrate in the default
  pose (e.g. the legs) keep their shared plane - pose the model and they
  separate.
- Edges/corners show a one-texel-deep notch where the inflated ring of the
  original layer used to be (inherent to per-pixel cubes with box UV).
- **Idempotent**: only `Cube` elements named `... Layer` are scanned; generated
  groups are never re-processed, so a second run is a no-op.
- **Atomic**: the whole run is one undo transaction; failures roll back.
- Multi-texture models are supported per-face; each face uses its own texture.
- Face UV direction (reversed U/V) and face rotation (0/90/180/270) are
  honored; see `docs/UV_MAPPING.md`.

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
64x64 Steve skin whose six layer cubes voxelize into exactly **880 cubes**
(golden test).

## Known limitations (v0.1)

- Edge/corner bevels between adjacent faces of a layer stay open (Minecraft's
  inflated shells cover them; a future edge-overlap mode may fill them).
- Desktop variant only for now; web is untested.
- No regeneration workflow yet: re-voxelizing requires undoing to the original
  layer cubes first.
- No greedy merging by design: one pixel = one cube is the core contract.

## License

Not yet decided (UNLICENSED). All rights reserved until a license is chosen.
