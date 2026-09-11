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

Voxels are **full unit-texel cubes** (edge length = one skin texel; 1 unit at
64px, 0.5 at 128px) tiling the RAW box face (not the inflated one) and
protruding one texel outward along the face normal:

```
north: z = [from.z - standoff - depth, from.z - standoff]
south: z = [to.z + standoff, to.z + standoff + depth]      (depth = 1 texel)
east:  x = [to.x + standoff, to.x + standoff + depth]
west:  x = [from.x - standoff - depth, from.x - standoff]
up:    y = [to.y + standoff, to.y + standoff + depth]
down:  y = [from.y - standoff - depth, from.y - standoff]
```

- All faces of every voxel are enabled; no voxel or pixel is ever hidden.
- Each face direction tiles its own raw box face, so slabs of different
  directions never overlap -> no coplanar duplicates -> no z-fighting inside
  a part.
- The uniform standoff (0.001) keeps voxel inner faces off the base cube's
  surface (same-part ghosting).
- Source cubes from DIFFERENT parts may interpenetrate (reference model legs
  overlap by 0.2); their shared planes are kept as-is - cross-part ghosting
  in the default pose is accepted and disappears once the model is posed.
- Edges/corners: the inflated ring of the original layer is not covered;
  each edge shows a one-texel-deep notch (documented limitation).

## UV mapping

Voxels use **box UV** (`box_uv: true`, matching the source model). Each
voxel's `uv_offset` is computed from its source pixel position so the shell
face samples exactly that pixel; the five other faces sample the neighboring
pixels of the box unwrap (inherent to box UV - six faces cannot all map to
one pixel):

```
north: uv_offset = (px - d, py - d)
south: uv_offset = (px - 2d - w, py - d)
west:  uv_offset = (px - d - w, py - d)
east:  uv_offset = (px, py - d)
up:    uv_offset = (px - d, py)
down:  uv_offset = (px - d - w, py)
```

(w = voxel x-size, d = voxel z-size in UV units; px/py = the pixel's top-left
corner in UV units.) The cell-to-texel mapping ports Blockbench
`CubeFace.UVToLocal` semantics: reversed UV rects (`u2 < u1`, `v2 < v1`) and
face rotation (0/90/180/270) are honored before the offset is applied; never
normalize with min/max. Every voxel copies source `origin` and `rotation`
(rotation lives on the voxels, never on the new Group, to avoid double
rotation) and uses `autouv: 0`.

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
}
```

`10_000` / `200` are engineering defaults, not Blockbench limits.

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
