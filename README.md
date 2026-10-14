# Minecraft 3D Skin Layers

English | [简体中文](README.zh-CN.md)

A Blockbench plugin that turns Minecraft skins into true 3D voxel models: every texel becomes one full cube whose six faces all map to that exact pixel. Start from a built-in template and paint directly on the voxels, or convert the `... Layer` cubes of an existing skin model — every operation runs as a reversible, atomic undo transaction.

## Features

- **One pixel, one cube** — all six faces of every voxel map to the same source pixel, and the shell thickness matches the layer inflate, so the voxel shell reproduces the original layer contour.
- **Paint-first workflow** — the *3D Skin Model* format on the start screen / File > New opens a wizard (template, texture size, optional name & identifier) and hands you a fully voxelized model, transparent pixels included, ready to paint on.
- **Fully reversible** — generated groups store the complete source cube; restore rebuilds the original model exactly, even after saving and reopening.
- **Resolution-independent** — texel grids derive from texture size vs. UV space; 64×64, 128×128 and custom layouts all work without a hard-coded atlas.
- **English & 简体中文** UI via Blockbench's translation system.

## Installation

1. Download `minecraft_3d_skin_layers.js` from the [latest release](../../releases), or build it yourself (`npm run build`).
2. In Blockbench: **File > Plugins > ... > Load Plugin from File**, or copy the file into Blockbench's `plugins` folder.
3. Requires Blockbench **5.0.0+** (desktop app, web app and mobile / PWA).

## Where everything lives

| Entry point | What it does |
|---|---|
| Start screen / **File > New > 3D Skin Model** | New-skin wizard: template + texture size (+ optional model name / identifier, both may be left empty), creates a fully voxelized model |
| **3D Skin Model > Generate 3D Skin Layers** | Voxelize the `... Layer` cubes of the open model |
| **3D Skin Model > Regenerate Cubes** | Rebuild generated voxels from the current texture, in place |
| **3D Skin Model > Restore 3D Skin Layers** | Convert generated groups back into their original single cubes |
| **3D Skin Model > Clear Transparent Cubes** | Delete voxels whose pixel has become transparent |

The **3D Skin Model** menu appears in the menu bar (next to **File**) whenever a project is open.

## Quick start A — paint a new skin (recommended)

1. Open the start screen or **File > New > 3D Skin Model**.
2. In the wizard pick a **skin type** (Steve or Alex; Steve is the default), a **template** (Default model, Blockbench classic or Joint model; Default model is preselected) and a **texture size** (64 or 128). Optionally type a **model name** and/or **model identifier** — both can be left empty (an empty name keeps the `temp-<size>` project name, an empty identifier stays unset; both are editable later under File > Project). The matching skin texture is loaded into the template and *every* pixel — transparent ones included — becomes a cube, so you can paint anywhere right away.
3. Paint your skin (Paint mode works; the texture behaves like a normal skin).
4. Clean up as you go:
   - **Clear Transparent Cubes** deletes voxels on pixels that are still transparent.
   - After bigger repaints, **Regenerate Cubes** rebuilds all voxels from the current texture — group poses are kept.

Every step is one undo transaction (`Ctrl/Cmd + Z`).

## Quick start B — voxelize an existing skin model

1. Open the model in **Edit** mode. It needs cubes named `... Layer` (`Hat Layer`, `Body Layer1`, ... — digit suffixes on jointed models are fine). The layer cubes' geometry and UVs are the source of truth, so 64×64, 128×128 and custom layouts all work without a hard-coded atlas.
2. Run **3D Skin Model > Generate 3D Skin Layers**. The preflight dialog shows how many layer cubes and texels were found; choose the remaining options and confirm. Alpha handling, the 10,000-cube limit and batch size use fixed defaults.
3. To get the original model back, run **3D Skin Model > Restore 3D Skin Layers** — generated groups store the complete original cube data (works after saving and reopening).

Both dialogs offer a **Use a new model project** checkbox at the bottom: check it to duplicate the project and run against the copy. The original tab stays untouched, and the copy never inherits the original's save path, so saving it always asks where to store it and can never overwrite the original file.

## Commands in detail

### New 3D Skin Model wizard

- Templates are embedded in the plugin — no extra files needed. 128 loads a 128×128 texture over the same 64-unit UV space (2× texel density, e.g. 16×16 head faces).
- The optional **model name** becomes the project (tab) name; the optional **model identifier** is stored as the bbmodel `model_identifier` (also editable under File > Project).
- The model is voxelized immediately with transparent pixels included, ready for the paint-then-clean-up loop. If the run needs more than 10,000 cubes, the plugin keeps the newly created project as an un-voxelized template and reports the required count and fixed limit.

### Generate 3D Skin Layers

- One full cube per non-transparent texel, all six faces mapped to that pixel.
- Replaces each `... Layer` cube with a same-named group at the original parent/sibling position, in one atomic undo step. The run aborts above the cube limit before touching anything.
- Idempotent: generated groups are never re-processed. On project load the plugin scans for layer cubes; it only auto-generates if **Generate automatically when a project loads** is enabled.

### Regenerate Cubes

- Re-scans the current texture and rebuilds every generated group in place. Groups (and anything you posed on them) are kept; only the voxel cubes are replaced. Use it after repainting instead of undoing.
- The dialog has an **Include transparent pixels** checkbox to voxelize every grid cell.

### Restore 3D Skin Layers

- Groups generated by this plugin store the full source cube (geometry, transforms, visibility, render settings, textures, UVs, face rotations); restore rebuilds it exactly and removes the voxels. Pre-0.3.1 groups fall back to a best-effort reconstruction.

### Clear Transparent Cubes

- Removes generated voxels whose sampled pixel has become transparent. Safe by construction: only cubes inside plugin-generated groups are considered, and only when their UV maps exactly one texel.

## Options reference

User-adjustable options are remembered across sessions. Alpha threshold is fixed at 0, the run limit at 10,000 cubes, and the UI batch size at 200 cubes.

| Option | Where | Default | Meaning |
|---|---|---|---|
| Keep original layer cubes | Generate dialog | off | hide the sources instead of deleting them |
| Replace fully transparent layers | Generate dialog | off | empty groups instead of leaving them untouched |
| Only process selected layer cubes | Generate dialog | off | restrict to selected layer cubes |
| Generate automatically when a project loads | Generate dialog | off | auto-run when a project opens |
| Use a new model project | Generate / Restore dialog | off | duplicate to a new project and modify the copy |
| Include transparent pixels | Regenerate dialog | off | voxelize every grid cell, transparent ones too |

## Good to know

- **Z-fighting-free within a part**: face shells carry an invisible per-direction offset (max 0.0075). Parts that interpenetrate in the default pose (legs, waist) share planes on purpose — pose them and it separates.
- **Multi-texture, reversed UVs and face rotation** (0/90/180/270) are honored per face.
- Generation, regeneration, restore and cleanup each run as a single atomic undo transaction with rollback on failure.

## Limitations & roadmap

- Works in the desktop app and in the web app / PWA on mobile; voxelizing a full skin (hundreds to ~1600 cubes) is noticeably slower on phone hardware.
- Hairline seams can appear at extreme grazing angles along layer edges.
- Regeneration requires plugin-generated groups (metadata); legacy groups from before 0.3.1 support restore only.
- No greedy merging by design: one pixel = one cube is the contract.

## Development

```bash
npm install
npm run check      # typecheck + tests + build
npm run test:watch # vitest watch mode
```

- `docs/SPEC.md` — behavioral contract and defaults
- `docs/ARCHITECTURE.md` — module map, data flow, WriterHost seam
- `docs/UV_MAPPING.md` — the exact UV/geometry math (ported from Blockbench)
- `docs/TEST_PLAN.md` — test matrix and manual acceptance steps

Legacy compatibility fixtures (covered by integration tests): `skin_model.bbmodel` — 880 visible cubes; `skins_model_root.bbmodel` — 618 visible / 1632 full pixels; `skins_model_root_joint.bbmodel` — 680 visible / 1792 full pixels. Current Steve/Alex templates and their updated joint goldens are listed in `docs/TEMPLATE_ASSETS.md`.

### Contributing

Issues and PRs welcome. Run `npm run check` before submitting and follow [Conventional Commits](https://www.conventionalcommits.org).

## Author

Follow the developer on Bilibili: **[b23.tv/s1TcV9m](https://b23.tv/s1TcV9m)**

## License

Released under the [MIT License](LICENSE).
