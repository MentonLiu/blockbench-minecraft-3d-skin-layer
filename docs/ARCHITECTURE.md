# ARCHITECTURE

## Module map

```
src/
├── index.ts                 BBPlugin.register entry (metadata, onload/onunload)
├── plugin.ts                Controller: scan -> preflight -> dialog -> apply; actions, events
│
├── domain/
│   ├── types.ts             Pure data contracts (snapshots, plans, options)
│   └── constants.ts         Plugin id, layer name regex, defaults
│
├── scan/
│   └── layerScanner.ts      Finds `* Layer` cubes (pure)
│
├── texture/
│   └── pixelReader.ts       UV->texel grid math, alpha scan, sampling (pure)
│
├── geometry/
│   ├── faceMapper.ts        UVToLocal port: face spans, points, voxel bounds (pure)
│   ├── depthStrategy.ts     preserve_layer / pixel / fixed thickness (pure)
│   └── voxelPlanner.ts      Snapshots + textures -> voxel plans (pure)
│
├── blockbench/
│   ├── compatibility.ts     Live Cube/Texture -> snapshots/pixel sources; events, mode gates
│   ├── modelWriter.ts       WriterHost seam + transactional applyPlans
│   ├── undoTransaction.ts   Undo.initEdit/finishEdit/cancelEdit wrapper
│   └── blockbenchHost.ts    Production WriterHost over Blockbench globals
│
├── ui/
│   ├── settingsDialog.ts    Preflight dialog + option persistence (localStorage)
│   └── resultReporter.ts    Toasts/status messages
│
└── infra/
    └── logger.ts            Prefixed console logging
```

## Data flow

```
Cube.all --collectLayerSnapshots--> LayerSnapshot[]
Texture.all --textureToPixelSource--> PixelSource (one getImageData per texture)
                                        │
              buildVoxelPlans(snapshot, textures, options)
                                        │ pure, no mutation
                                  LayerPlan[] (+ warnings)
                                        │ preflight: count <= maxVoxels
              applyPlans(plans, options, WriterHost, sources)
                                        │ one Undo transaction
                    groups + voxel cubes + targeted Canvas.updateView
```

Everything up to `applyPlans` is pure and runs under `vitest` in Node. The only
Blockbench-coupled code is `blockbench/` + `ui/` + entry points.

## The WriterHost seam

`applyPlans` (group creation, sibling placement, batched voxel creation,
source removal, undo scoping) is the part of the plugin where mistakes destroy
user models. It is written against a small `WriterHost` interface:

- `blockbenchHost` implements it with `Group`, `Cube`, `Undo`, `Canvas.updateView`.
- `tests/helpers/mockRuntime.ts` implements the same semantics (tree, registry,
  snapshot-based undo/redo) so replacement, rollback, batching and idempotency
  are integration-tested without Blockbench.

Element lifecycle used by both implementations, matching Blockbench's own
outliner semantics:

```
create -> init() (registers at outliner root) -> adopt(parent) -> placeBefore(source)
voxel cubes: create -> init() -> adopt(layerGroup)
source: remove() or setVisibility(false) when preserveOriginal
```

Rotation/origin are copied onto every voxel and never onto the group, so no
double transforms occur; the group inherits the source's visibility.

## Performance model

- one `getImageData` per referenced texture, alpha reads from a typed array;
- planning is O(visible texels), no canvas access in hot loops;
- cube creation batches (default 200) with `yieldToUI` between batches;
- only `Canvas.updateView({elements: created})` runs - never `Canvas.updateAll()`;
- preflight aborts above `maxVoxels` (default 10,000) before the undo scope opens.
