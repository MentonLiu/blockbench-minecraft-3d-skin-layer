# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com) and the
versioning follows [SemVer 2.0.0](https://semver.org).

## [Unreleased]

### Added

- Both dialogs (Generate and Restore) now offer a **target model** choice:
  modify the current model as before, or duplicate the project into a new tab
  and apply the changes to the copy. Copies use Blockbench's own
  `duplicate_project` recipe (`Codecs.project.compile` with embedded bitmaps →
  `setupProject` → `Codecs.project.parse`), receive a descriptive name suffix
  (`- 3D Layers` / `- Restored`), and do not inherit the original's save path,
  so saving the copy always goes through "Save As" and can never overwrite the
  original file.
- The restore flow now shows a preflight dialog (previously it ran silently)
  reporting how many generated groups and voxels will be restored, with the
  same target model choice.
- Project duplication suppresses the plugin's `load_project` auto-scan while
  `Codecs.project.parse` dispatches the event, so a fresh copy is never
  auto-voxelized; the choice is remembered like every other option.

### Fixed

- The manual generation run previously applied the plan computed *before* the
  dialog, so changing the alpha threshold inside the dialog had no effect on
  the generated result. The plan is now recomputed with the confirmed options
  (and serves as the final preflight before a copy is created).

## [0.3.1] - 2026-09-17

### Added

- Added **Restore 3D Skin Layers**, an Edit-menu action that converts generated
  voxel groups back into their original single layer cubes.
- Generated groups persist the complete source cube snapshot, including
  geometry, transforms, visibility, render settings, textures, UVs and face
  rotations, making the conversion reversible across saved projects.
- Added one atomic undo transaction for restoration, support for preserved
  hidden source cubes, and compatibility reconstruction for legacy generated
  groups from before 0.3.1.

## [0.3.0] - 2026-09-13

### Added

- Support for the new jointed segment templates: layer cube names with digit
  suffixes (`Body Layer1`, `Right Arm Layer2`, ...) are now detected via the
  extended name pattern `/\sLayer\d*$/i`. Standard names (`Hat Layer`, ...) keep
  matching; false positives (`MyLayer1`, `Layer Helper`, `Hat Layer Group`)
  are still rejected.
- New integration fixtures characterized from the two new template models:
  `skins_model_root.bbmodel` (whole model wrapped in an extra root group, 12
  embedded 128x128 textures with a 64x64 UV space, all layer faces sharing one
  texture - 2828 voxels) and `skins_model_root_joint.bbmodel` (body/arms/legs
  split into upper + lower pivot segments - 404 voxels across 11 layer cubes).
- Segment layers with `box_uv: false` (per-face UV), reversed UV rects on the
  lower leg layers, and deep parent-group nesting are covered by the new
  golden tests; layer cubes without an `inflate` value voxelize to flat
  zero-thickness cards (faithful to the original coplanar shell).
- The fixture loader is now generic (`loadFixtureModel`): any `.bbmodel` with
  multiple embedded textures and integer texture references can serve as a
  test model.

## [0.2.1] - 2026-09-12

### Fixed

- Severe z-fighting inside a part: adjacent face grids share the inflated
  shell, so corner voxels of neighbouring directions produced coplanar
  duplicate faces - up to 1668 overlapping face pairs on the reference model.
  Each direction now carries a tiny epsilon (north 0, east 0.0015, ... down
  0.0075) applied as a translation of its face grid plus extra thickness, so
  faces of different directions never share a plane. Reference model
  verification: 0 intra-part coplanar pairs with all 5280 faces enabled,
  live in Blockbench 5.1.6 at 60 FPS.
- Voxel inner faces are lifted 0.001 off the base cube's surface, removing
  the ghosting visible through the edge gaps.

### Changed

- Re-affirmed the product contract per user feedback: every visible texel
  becomes a full voxel with **all six faces enabled and mapped to the same
  source pixel** (per-face UV), and the thickness always matches the original
  layer inflate - the voxel shell reproduces the original layer contour.
  Nothing is ever hidden. Cross-part overlaps of the default pose (legs, waist)
  are intentionally untouched; posing the model separates them.

## [0.2.0] - 2026-09-12

### Added

- Localization through Blockbench's native translation system
  (`Language.addTranslations` + `tl`): English and Simplified Chinese catalog
  for the action, the preflight dialog and every toast/status message.
  The English catalog doubles as the lookup fallback; other Blockbench
  interface languages fall back to English until contributed. Dictionary
  consistency (key parity, placeholder anchors) is covered by unit tests.

## [0.1.2] - 2026-09-12

### Added

- The action now appears in the **Edit menu** as "Generate 3D Skin Layers".
  Previously it was only reachable through the action search / keybindings
  panel, because Blockbench does not insert plugin actions into menus
  automatically. The menu entry is removed again when the plugin is disabled
  or uninstalled.

## [0.1.1] - 2026-09-12

### Fixed

- Redo after a generation run crashed inside Blockbench's undo system with
  "groups is not iterable": the `groups` undo aspect is now passed to BOTH
  transaction ends - `Undo.initEdit` receives an empty list and
  `Undo.finishEdit` the created groups. Blockbench's `loadSave` compares the
  before/after saves against each other, so a missing list on either side is
  fatal. Found and verified during a live Blockbench 5.1.6 run (reference
  model, 880 voxels, undo/redo now exception-free); regression test added.

## [0.1.0] - 2026-09-11

### Added

- Layer scanner: detects `* Layer` cubes by name (`/\sLayer$/i`), cube-only
  scan for idempotency, optional selection filter.
- Texture pipeline: one-time pixel cache per texture, UV-space to image-texel
  mapping derived from `width/uvWidth` (no hard-coded resolutions), alpha
  scanning with configurable threshold, reversed UV and face rotation support,
  non-integer texel spans reported instead of silently rounded.
- Geometry: `CubeFace.UVToLocal`-faithful face mapping for all six directions,
  voxel bounds anchored at the raw box surface, depth modes
  `preserve_layer` / `pixel` / `fixed`.
- Planner: one voxel per visible texel, all six faces mapped to the same image
  pixel, per-face texture support, warnings for skipped faces/layers.
- Writer: same-name group replacement at the original parent/sibling position,
  batched cube creation with UI yields, targeted `Canvas.updateView`, single
  atomic undo transaction with rollback on failure, `maxVoxels` preflight.
- UI: preflight settings dialog with persisted options, toast/status reporting.
- Plugin lifecycle: edit-mode-gated action, project-load scan hook.
- Tests: 77 unit/integration tests including the reference model golden run
  (880 voxels), mock-outliner undo/rollback/idempotency, and a 2x resolution
  fixture.
