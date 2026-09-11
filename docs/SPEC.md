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
9. A generated voxel must map all six faces to the source texel.
10. `alpha === 0` is skipped by default (`alphaThreshold: 0`, visible when `alpha > threshold`).
11. Run typecheck, test and build before every engineering commit.
12. Use Conventional Commits.
13. One logical change per commit.
14. Do not silently increase `maxVoxels`.
15. Do not add hard-coded support for untested Blockbench internals.

## Detection

```
Layer name pattern   /\sLayer$/i        ("Hat Layer" yes, "MyLayer" no, "Layer Helper" no)
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

Face planes and grids use the **inflated box** (`from - inflate`, `to + inflate`
per axis, times `stretch`), matching Blockbench's `adjustFromAndToForInflateAndStretch`
and `CubeFace.UVToLocal`. Voxel thickness anchors at the **raw box surface** and
extends outward along the face normal:

```
north: z = [from.z - depth, from.z]      south: z = [to.z, to.z + depth]
east:  x = [to.x, to.x + depth]          west:  x = [from.x - depth, from.x]
up:    y = [to.y, to.y + depth]          down:  y = [from.y - depth, from.y]
```

Depth modes:

| mode | depth | effect |
|---|---|---|
| `preserve_layer` (default) | `inflate` (fallback: face texel size when inflate <= 0) | outer contour equals the original layer surface |
| `pixel` | mean in-face texel edge length | full 1x1x1 voxel look |
| `fixed` | `fixedDepth` | user-controlled |

Edge/corner bevels between adjacent faces are left open in v0.1 (documented limitation).

## UV mapping

The mapper is a faithful port of Blockbench `CubeFace.UVToLocal` semantics
(see `docs/UV_MAPPING.md`). Reversed UV rects (`u2 < u1`, `v2 < v1`) and face
rotation (0/90/180/270) must be honored; never normalize with min/max.

Every generated voxel cube:

- has its six faces mapped to the single source texel rectangle
  `[px/sx, py/sy, (px+1)/sx, (py+1)/sy]`, texture = the source face's texture;
- uses `box_uv: false`, `autouv: 0`;
- copies source `origin` and `rotation` (rotation lives on the voxels, never on
  the new Group, to avoid double rotation);
- leaves two kinds of faces disabled (`texture: null`) to keep the shell free
  of coplanar duplicate surfaces (z-fighting): the inner face against the base
  cube, and - when the outer surface lies exactly on the inflated shell
  (preserve_layer) - side faces landing on a neighbouring direction's shell
  plane, which that direction's own voxels own, matching the original box.

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
  depthMode: 'preserve_layer',
  fixedDepth: 0.25,
  preserveOriginal: false,
  replaceEmptyLayer: false,
  autoApplyOnLoad: false,
  processSelectedOnly: false,
  useUVToLocalWhenAvailable: false,
}
```

`10_000` / `200` are engineering defaults, not Blockbench limits.

## Acceptance (reference model, alphaThreshold 0)

```
Layer cubes found: 6
Visible texel instances: Hat 168, Body 168, Right/Left Arm 136 each,
                         Right/Left Leg 136 each -> total 880
Generated voxel cubes:   880
Undo restores the original 6 Layer cubes and hierarchy; redo restores the voxels.
Second run generates 0 cubes.
```
