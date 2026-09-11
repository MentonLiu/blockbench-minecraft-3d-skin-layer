# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com) and the
versioning follows [SemVer 2.0.0](https://semver.org).

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
