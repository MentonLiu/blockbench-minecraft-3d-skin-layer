# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com) and the
versioning follows [SemVer 2.0.0](https://semver.org).

## [0.5.1] - 2026-10-15

### Fixed

- Refresh Steve and Alex joint templates with the supplied model detail and
  per-face UV adjustments, preserving authored outer-layer geometry and pivots.
- Import joint templates that already contain `Right Arm Layer2` without adding
  a duplicate; older templates still receive the missing outer layer.
- Update embedded resources and 64/128px voxel-count regression baselines.

### Known limitation

- The supplied Alex template still places `Right Arm Layer2` at Y=18–24 while
  the corresponding base forearm is at Y=12–18. This release preserves the
  supplied asset; it does not claim to correct that alignment.

## [0.5.0] - 2026-10-15

Stable release of the 0.5 preview cycle. Includes the Web and mobile/PWA support
introduced in `0.5.0-pre`; existing preview releases remain available unchanged.

### Added

- Steve and Alex skin types, each with Default, Blockbench classic and Joint
  templates, matching 64/128px textures, and complete right forearm outer layers
  in both joint templates. The default is Steve / Default model / 64px.
- Six optional Desktop MCP tools for inspect, generate, restore, regenerate,
  clear-transparent and new-skin operations. Requires Blockbench MCP 1.10.0 or
  a compatible later 1.x release; normal UI use needs no MCP plugin.
- A shared operation service with structured results, a single write lock,
  request cancellation and project-bound rollback for UI and MCP operations.

### Changed

- Alpha threshold, maximum voxel count and batch size are fixed at 0 / 10,000 /
  200. Their controls are removed; old numeric settings migrate while the other
  user preferences are preserved. Oversized plans stop before voxel writes;
  new-skin runs retain the bare template.

### Fixed

- Regeneration preserves a whole layer when an enabled face texture is missing
  or unreadable, while readable fully transparent layers still clear old cubes
  when transparent pixels are excluded.
- Stale MCP setup callbacks cannot revive tools after unload; partial
  registration is cleaned up and retryable. Paint-mode regeneration and
  transparent cleanup availability matches the regular UI.
- Undo cancellation restores the previous active project even when selecting
  the operation target fails. Failed or cancelled writes leave no partial voxels.

## [0.5.0-pre] - 2026-10-05

### Added

- **Web & mobile support.** The plugin now declares the `both` variant, so it
  can be installed and used in the web app and PWA (phones / tablets), not
  just the desktop app. All entry points work with touch: Blockbench's mobile
  menu bar lists the top-level **3D Skin Model** menu, and Blockbench's own
  small-screen CSS collapses dialogs to full width, so the 512 px preflight
  dialogs fit phone displays without changes.

- The plugin sets `await_loading`, so its **3D Skin Model** format is always
  registered before the first project opens - this matters on the web app,
  where plugin files download asynchronously and an early-opened skin file
  would otherwise fall back to a generic format.

## [0.4.0] - 2026-09-30

> Official release. Includes everything from `0.4.0-pre` and `0.4.0-pre2`.

### Added

- The New 3D Skin Model wizard accepts an optional **model name** and an
  optional **model identifier**. The name becomes the project (tab) name
  instead of the `temp-<size>` default; the identifier is saved as the
  bbmodel `model_identifier` and editable later under File > Project. Both
  fields can be left empty - empty falls back to the previous behavior.

### Changed

- All plugin commands now live in the top-level **3D Skin Model** menu.
  Generate 3D Skin Layers and Restore 3D Skin Layers moved out of the Edit
  menu, so every entry point (generate, regenerate, restore, clear
  transparent cubes) is in one place next to File.

## [0.4.0-pre2] - 2026-09-28

### Added

- **Regenerate Cubes** joins the 3D Skin Model menu: it re-scans the CURRENT
  texture and rebuilds every generated voxel group in place - groups and their
  poses are kept, old cubes are replaced in one atomic undo transaction. The
  preflight dialog shows the incoming cube count and an "include transparent
  pixels" checkbox, so the paint-then-regenerate workflow needs no undoing.

### Fixed

- The new-skin wizard no longer falls back to the 64px temp texture when the
  user picks **128 × 128**. Blockbench Dialog select values arrive as strings
  (`"128"`), and `SKIN_SIZES.includes("128")` on a numeric array was always
  false, so 128 selections silently became `temp-64` with 64-density cubes.
  Wizard form values are now normalized via `parseSkinSize` / `parseTemplateId`,
  and `buildTemplateModel` accepts dialog string sizes while still rejecting
  unknown template ids and non-embedded sizes.

## [0.4.0-pre] - 2026-09-20

### Added

- A **3D Skin Model** format now appears on the start screen and in
  File > New. Its wizard picks one of three embedded template models (classic
  layout, root-wrapped, jointed segments) and a skin texture size (64 or 128);
  the matching temp skin texture is loaded into the template (128 doubles the
  texel density over the same 64-unit UV space) and the model is voxelized
  immediately - **every pixel becomes a cube, transparent ones included** -
  ready for the paint-then-cleanup workflow.
- A top-level **3D Skin Model** menu (next to File) with a one-click
  **Clear Transparent Cubes** action: it removes generated voxel cubes whose
  sampled pixel has become transparent, in one atomic undo transaction.
  Non-voxel cubes, missing textures and out-of-range samples are never touched.
- Generation gained an `includeTransparent` mode used by the wizard; standard
  generation keeps skipping transparent pixels.

## [0.3.1] - 2026-09-20

### Added

- Added **Restore 3D Skin Layers**, an Edit-menu action that converts generated
  voxel groups back into their original single layer cubes.
- Generated groups persist the complete source cube snapshot, including
  geometry, transforms, visibility, render settings, textures, UVs and face
  rotations, making the conversion reversible across saved projects.
- Added one atomic undo transaction for restoration, support for preserved
  hidden source cubes, and compatibility reconstruction for legacy generated
  groups from before 0.3.1.
- Both dialogs (Generate and Restore) now offer a **target model** choice:
  modify the current model as before, or duplicate the project into a new tab
  and apply the changes to the copy. Copies use Blockbench's own
  `duplicate_project` recipe (`Codecs.project.compile` with embedded bitmaps →
  `setupProject` → `Codecs.project.parse`), receive a descriptive name suffix
  (`- 3D Layers` / `- Restored`), and do not inherit the original's save path,
  so saving the copy always goes through "Save As" and can never overwrite the
  original file. The choice is a "Use a new model project" checkbox at the
  bottom of each dialog and is remembered like every other option.
- The restore flow now shows a preflight dialog (previously it ran silently)
  reporting how many generated groups and voxels will be restored, with the
  same target model choice.
- Project duplication suppresses the plugin's `load_project` auto-scan while
  `Codecs.project.parse` dispatches the event, so a fresh copy is never
  auto-voxelized.

### Fixed

- The manual generation run previously applied the plan computed *before* the
  dialog, so changing the alpha threshold inside the dialog had no effect on
  the generated result. The plan is now recomputed with the confirmed options
  (and serves as the final preflight before a copy is created).

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
