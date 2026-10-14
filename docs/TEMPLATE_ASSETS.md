# Steve/Alex template assets

The wizard uses these labels and defaults:

| Selection | Display label | Default |
|---|---|---|
| Skin type `steve` | Steve | Yes |
| Skin type `alex` | Alex | No |
| Template `root` | Default model | Yes |
| Template `classic` | Blockbench classic | No |
| Template `joint` | Joint model | No |
| Texture size | 64 / 128 | 64 |

Template IDs remain `root`, `classic` and `joint`; only their display labels and
initial selection changed. The project tab name remains `temp-64` or `temp-128`
unless the user enters a custom name.

## Source inputs

These SHA-256 values identify the unchanged files imported from the workspace's
`temp_model/` directory on 2026-10-14. The import script accepts that directory
or another explicit source directory:

```sh
node scripts/import-skin-templates.mjs /path/to/temp_model
node scripts/embed-templates.mjs
```

| Source file | SHA-256 |
|---|---|
| `steve_skins_model.bbmodel` | `5838003252cb29f4382e7acf30d438e92bee06c206fde7bc3bca5f12c10d6923` |
| `steve_skins_model_root.bbmodel` | `8eae549c763105f25d7b7484c3c3ab501bda4d046427abf3ac3950427032a5c0` |
| `steve_skins_model_root_joint.bbmodel` | `823b84fb98f674bc33d399a0e949178facaa2237a6ad848e4cb9d4ebf3800e41` |
| `alex_skins_model.bbmodel` | `b197369515d4c515fe4a0bc8788e18abb60ae31c9eaf869ff8221b9aae078cb9` |
| `alex_skins_model_root.bbmodel` | `e12ebbe225d3524abe2041082718988008a738df13b00b103663f5f044c5edf9` |
| `alex_skins_model_root_joint.bbmodel` | `c59f2a0191a06f93262e484222692c92aa5eb8b0dba66b375c3e51937a9256d3` |
| `steve-64.png` | `c4b0bfc951e52c431b018ef38146efd5309e30eea45b495197f9e23171bf3000` |
| `steve-128.png` | `981a7ad7d2e3191202bed9bc1ee82d1984e1afa73a7ab17490f83e4cf31259f2` |
| `alex-64.png` | `f35f7be45e24a414f0ab12eb0d47710a2ca8788eb4b36851113f493d8645ff1f` |
| `alex-128.png` | `7c3f741ad3e79d534be230ead0c9c3a8c1e5fcc0548ac4b56a0261daf98ae92b` |

The imported models preserve the supplied geometry, UVs, groups, pivots and
animations. The import removes saved editor selection flags and external image
paths, embeds no texture source in the model files, and compacts texture tables
to the face references. In the supplied Alex joint model, all faces referenced
texture index 1; the unused index 0 is removed and index 1 is remapped to 0.
The four PNG files are kept as independent assets and injected when a project
is created. Their image dimensions are 64 or 128 while the model UV space stays
64.

## Right forearm outer layer

Both joint templates include a new hidden `Right Arm Layer2` cube under the
existing `Right Arm2` bone. It copies the corresponding base cube's bounds,
pivot and face texture references, uses inflate `0.25`, and shifts each face's V
coordinates and `uv_offset` V value by 16. Steve keeps its four-unit arm width;
Alex keeps its three-unit width and its own UV map. The importer creates a
stable, unique UUID and places the outer cube beside `Right Arm2` in that bone.

Each joint template now contains 22 cubes and 11 `* Layer` cubes. The added
layer leaves animations attached to the existing bone UUIDs.

## Current joint template goldens

Counts use the supplied matching image at the chosen size, with UV space fixed
at 64. “Full” includes transparent cells, as in the new-skin wizard.

| Skin | Size | Visible cubes | Full cubes |
|---|---:|---:|---:|
| Steve | 64 | 720 | 1,920 |
| Steve | 128 | 4,622 | 7,680 |
| Alex | 64 | 754 | 1,840 |
| Alex | 128 | 3,310 | 7,360 |

The legacy fixtures under `tests/fixtures/` remain in place with their original
goldens to cover opening and restoring models created by earlier releases.
