# TEST PLAN

Run everything with:

```bash
npm run check   # typecheck + tests + build
```

## Scope

The planning/geometry pipeline is pure TypeScript and fully covered in Node.
Blockbench-runtime code (`blockbenchHost`, dialogs) is kept thin and is
exercised through the `WriterHost` mock; the final acceptance is loading
`dist/minecraft_3d_skin_layers.js` in Blockbench and running it against
`skin_model.bbmodel`.

## Unit matrix (tests/unit)

| Area | Cases |
|---|---|
| Layer matcher | `Hat Layer` yes; case-insensitive; `MyLayer`, `Layer Helper`, `LayerExtra`, `Layer` no |
| Scan idempotency | converted models (no cubes, voxel names) produce no matches |
| Texture scale | 64/64 -> 1; 128 image / 64 UV -> 2 |
| Grid size | head front 8x8; 16x16 at 2x; rotation 90/270 swap; non-integer span rejected with warning; out-of-bounds rect warns |
| Cell sampling | first cell -> region top-left pixel; last -> bottom-right; reversed U/V preserved; rotation 90 transposed; out-of-bounds clamped |
| Alpha | threshold 0 keeps alpha 1; raised threshold filters; degenerate rect -> empty scan |
| Inflate box | inflate expansion; stretch around center |
| Face points | all six directions match `UVToLocal` (u1/v1 corners) |
| Voxel bounds | all six directions protrude from the raw surface; depth=inflate reproduces the layer surface |
| Depth modes | preserve_layer (inflate + zero-inflate fallback), pixel mean edge, fixed, degenerate clamp |
| Planner | 384 voxels for an opaque hat cube; unique names; single-texel UV; same pixel on all 6 faces; transparent skipping; alpha threshold; empty-layer policy; missing texture warnings; per-face textures; pixel/fixed depth |

## Integration (tests/integration)

| Scenario | Expectation |
|---|---|
| Reference model golden | 6 layer cubes; Hat 168, Body 168, Arms 136, Legs 136; **total 880**; per-face counts; pixel UV spans exactly one image pixel; hat voxels on inflated surfaces; inset leg geometry; hidden visibility inherited |
| Writer on mock outliner | same-name group replaces the cube at the same parent/sibling slot; 168 voxels in the hat group; base cubes untouched; visibility/origin inherited; single undo transaction; undo/redo restore both states; maxVoxels aborts pre-mutation; mid-run failure reverts via cancelUndo; 5 UI yields at batchSize 200; targeted updateView calls; preserveOriginal hides; second scan finds no layer cubes (idempotent) |
| 2x resolution | 128px image / 64 UV -> head front 16x16; reversed top-face UV still correct; pixelUV spans 0.5 UV units; voxel faces 0.5625 model units |

## Manual acceptance in Blockbench (per release)

1. Load `skin_model.bbmodel`, run *Generate 3D Skin Layers*, confirm the
   dialog reports 6 layers / 880 texels.
2. Outliner shows `Hat Layer`... groups under their original parents with the
   voxel cubes inside; original 6 layer cubes are gone.
3. `Ctrl+Z` once restores the original model; `Ctrl+Shift+Z` regenerates.
4. Running the action again reports "No * Layer cubes found".
5. Set alphaThreshold 255 -> run -> only fully opaque pixels become cubes.
6. depthMode `pixel` -> voxels visibly protrude by ~1 unit on a 64px skin.
