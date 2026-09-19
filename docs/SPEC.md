# SPEC — Minecraft 3D Skin Layers (minecraft_3d_skin_layers)

Contract for converting Minecraft skin outer layers into per-pixel voxel cubes
inside Blockbench. Derived from `plan.md`; the reference model
`skin_model.bbmodel` is the behavioral baseline.

## Hard constraints

1. Work only inside the plugin folder (`blockbench-minecraft-3d-skin-layer/`).
2. Keep main buildable after every milestone.
3. Use TypeScript and `blockbench-types`.
4. Do not hard-code the Minecraft skin atlas when a source Layer Cube exists.
5. Treat existing `* Layer` Cube geometry and face UV as source of truth.
6. Never mutate the model before preflight validation finishes.
7. Every destructive model operation must be inside Blockbench Undo.
8. Deleting/adding Outliner nodes must use `outliner` undo tracking.
9. A generated voxel's shell face must sample exactly its source pixel; the
   other faces follow the box UV unwrap of the voxel cube.
10. `alpha === 0` is skipped by default (`alphaThreshold: 0`, visible when `alpha > threshold`).
11. Run typecheck, test and build before every engineering commit.
12. Use Conventional Commits.
13. One logical change per commit.
14. Do not silently increase `maxVoxels`.
15. Do not add hard-coded support for untested Blockbench internals.
16. Never change the version number (package.json, plugin metadata, README
   badges, CHANGELOG release headers) without the user's explicit approval.
   Unreleased work goes under a `## [Unreleased]` CHANGELOG heading.

## Detection

```
Layer name pattern   /\sLayer\d*$/i     ("Hat Layer", "Body Layer1" yes; "MyLayer1", "Layer Helper" no)
Scan target          Cube.all only      (idempotency: generated Groups are never re-scanned)
Selection filter     only when options.processSelectedOnly is true
```

Effective layer rule:

```
no * Layer Cube                              -> do nothing
Layer Cube with zero visible texels          -> leave untouched (replaceEmptyLayer=false)
Layer Cube with >= 1 visible texel           -> voxelize and replace with same-name Group
```

A texel is visible when the source pixel's alpha is greater than
`options.alphaThreshold` on the face's own texture.

## Resolution

Never hard-code 32/64. For each texture:

```
scaleX = texture.width  / texture.getUVWidth()
scaleY = texture.height / texture.getUVHeight()
```

A face with UV rect `[u1,v1,u2,v2]` renders `Nu x Nv` texels:

```
Nu = |u2 - u1| * scaleX   (must be near-integer, otherwise the face is skipped with a warning)
Nv = |v2 - v1| * scaleY
```

128x128 image with 64x64 UV space therefore produces 2x texel counts
(head front 16x16) with no special-casing.

## Geometry

Voxels fill the layer's own shell: their grid tiles the **inflated box** (the
surface the original layer renders on), thickness = `inflate`, so the outer
surface reproduces the original layer contour. Every texel becomes a full
voxel with **all six faces enabled** - nothing is ever hidden.

To keep a part free of z-fighting even though adjacent face grids share the
inflated shell, each direction carries a tiny epsilon (north 0, east 0.0015,
... down 0.0075) applied as a translation of its face grid plus extra
thickness. All grid lines and shell planes of different directions end up
0.0015 apart - imperceptible, but the depth buffer never sees two faces on
the same plane. A uniform standoff (0.001) additionally lifts voxel inner
faces off the base cube's surface.

- Same part: zero coplanar overlapping face pairs (verified by exact
  rectangle-overlap analysis).
- Different parts that interpenetrate in the default pose (reference model
  legs overlap by 0.2): their shared planes are kept as-is - cross-part
  ghosting is accepted and disappears once the model is posed.

## UV mapping

Every voxel uses **per-face UV with all six faces mapped to the same source
pixel**: each face carries the rectangle
`[px/sx, py/sy, (px+1)/sx, (py+1)/sy]` and the source face's texture
(`box_uv: false`, `autouv: 0`). The cell-to-texel mapping ports Blockbench
`CubeFace.UVToLocal` semantics: reversed UV rects (`u2 < u1`, `v2 < v1`) and
face rotation (0/90/180/270) are honored; never normalize with min/max.
Every voxel copies source `origin` and `rotation` (rotation lives on the
voxels, never on the new Group, to avoid double rotation).

## Replacement

```
for each planned layer:
    Group(name = source.name, origin = source.origin, visibility = source.visibility)
    placed at source.parent, in front of source (sortInBefore)
    voxel cubes appended in batches, then source cube removed (or hidden when preserveOriginal)
```

The whole run is one Undo transaction:

```
Undo.initEdit({outliner: true, elements: sources})
... create groups + cubes, remove sources ...
Undo.finishEdit('Generate 3D skin layers', {outliner: true, elements: created, groups})
on error: Undo.cancelEdit(true) and rethrow
```

Second run finds no `* Layer` cubes (they are Groups now) and is a no-op.

## Preflight

All expensive work (texture reads, alpha scan, planning, counting) happens
before the model is touched. If the total voxel count exceeds `maxVoxels`
(default 10000) the run aborts with `VoxelLimitError` and the model is unchanged.

## Defaults

```ts
{
  alphaThreshold: 0,
  maxVoxels: 10_000,
  batchSize: 200,
  preserveOriginal: false,
  replaceEmptyLayer: false,
  autoApplyOnLoad: false,
  processSelectedOnly: false,
  useUVToLocalWhenAvailable: false,
  targetModel: 'current',
}
```

`10_000` / `200` are engineering defaults, not Blockbench limits.

## Run target (targetModel)

```
current  modify the open project in place (previous behavior)
copy     duplicate the project into a new tab, then run against the copy
```

- Offered in BOTH dialogs (generate + restore preflight); manual runs only -
  auto-generate on project load always targets the current project.
- Copy recipe (same as Blockbench's `duplicate_project` action):
  `Codecs.project.compile({raw: true, bitmaps: true})` -> `setupProject` ->
  `Codecs.project.parse(model, '')`; rename the copy with a suffix
  (`- 3D Layers` / `- Restored`).
- The copy does NOT inherit `save_path` (empty path on parse), so saving it
  always goes through "Save As" - the original file can never be overwritten.
- The plugin's `load_project` auto-scan is suppressed while parsing, otherwise
  the fresh copy would be auto-voxelized.
- Plans are pure data + uuids and resolve against the active project at write
  time; restore candidates hold live object references and are re-collected in
  the copy.
- Preflight (scan + maxVoxels) runs BEFORE duplicating; a failed preflight
  never creates a stray copy tab.

## Acceptance (reference model, alphaThreshold 0)

```
Layer cubes found: 6
Visible texel instances: Hat 168, Body 168, Right/Left Arm 136 each,
                         Right/Left Leg 136 each -> total 880
Generated voxel cubes:   880 (unit texel cubes, box UV, all faces enabled)
No coplanar overlap within any part.
Undo restores the original 6 Layer cubes and hierarchy; redo restores the voxels.
Second run generates 0 cubes.
```
