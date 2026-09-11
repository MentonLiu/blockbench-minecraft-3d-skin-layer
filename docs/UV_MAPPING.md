# UV MAPPING

How the plugin decides which image pixel ends up on which voxel, and why.

## Ground truth

The mapper is a faithful port of Blockbench's `CubeFace.UVToLocal` /
`adjustFromAndToForInflateAndStretch` (js/outliner/cube.js), because the plugin
must reproduce exactly what Blockbench renders for the original layer cube.

### Inflated box

Rendered faces lie on the inflated box:

```
center = (from + to) / 2
from'  = center - (size/2 + inflate) * stretch
to'    = center + (size/2 + inflate) * stretch
```

### Face parametrization (rotation 0)

`(mx, my) in [0,1]^2`, as seen from outside the face; `mx = 0` is the U1 side,
`my = 0` is the V1 side:

| face | U axis (mx 0 -> 1) | V axis (my 0 -> 1) | plane |
|---|---|---|---|
| north | x: to.x -> from.x | y: to.y -> from.y | z = from'.z |
| south | x: from.x -> to.x | y: to.y -> from.y | z = to'.z |
| east  | z: to.z -> from.z | y: to.y -> from.y | x = to'.x |
| west  | z: from.z -> to.z | y: to.y -> from.y | x = from'.x |
| up    | x: from.x -> to.x | z: from.z -> to.z | y = to'.y |
| down  | x: from.x -> to.x | z: to.z -> from.z | y = from'.y |

Note `up`: V1 sits at the **front** (`from.z`); with the skin's stored reversed
rect (e.g. head `[16,8,8,0]`) the hairline row (image bottom) lands at the
front of the head - the reversal is data, not a bug. `down` keeps V1 at the
back (`to.z`), which is why bottom faces appear flipped when viewed from below,
matching Minecraft.

### Face rotation

`UVToLocal` applies, once per 90 degrees of `face.rotation`:

```
[lerp_x, lerp_y] = [1 - lerp_y, lerp_x]
```

mapping UV parameters to model parameters. The mapper inverts it
(model cell -> UV parameter):

| rotation | pu, pv from (mx, my) |
|---|---|
| 0   | mx, my |
| 90  | my, 1 - mx |
| 180 | 1 - mx, 1 - my |
| 270 | 1 - my, mx |

With 90/270 the grid axis counts swap (cells along model-U = texelsV).

## Grid and sampling

For a face with UV rect `[u1,v1,u2,v2]` on a texture of scale
`sx = width / uvWidth`, `sy = height / uvHeight`:

```
texelsU = |u2 - u1| * sx        (must be near-integer, else the face is skipped with a warning)
texelsV = |v2 - v1| * sy
```

Every grid cell is sampled at its center; UV direction is preserved (never
min/max-normalized):

```
u = u1 + (u2 - u1) * (col + 0.5) / cols
v = v1 + (v2 - v1) * (row + 0.5) / rows
imageX = floor(u * sx)   imageY = floor(v * sy)
```

A reversed rect therefore samples the region mirrored, exactly like Blockbench
renders it. `faceGridSize` warns when a rect leaves the texture bounds
(sampling is clamped).

## Voxel geometry

The in-face rectangle of a cell is cut from the **inflated** face plane, so the
voxels tile the whole visible layer (the inflated face is wider than the raw
box). The thickness anchors at the **raw** box surface and extends outward
along the face normal:

```
north: z = [from.z - depth, from.z]        south: z = [to.z, to.z + depth]
east:  x = [to.x, to.x + depth]            west:  x = [from.x - depth, from.x]
up:    y = [to.y, to.y + depth]            down:  y = [from.y - depth, from.y]
```

With `depthMode = preserve_layer` (`depth = inflate`) the outer voxel surface
coincides exactly with the original layer surface; the voxels fill the gap the
inflated shell occupied. Edge/corner bevels between adjacent faces stay open in
v0.1 (known limitation, see README).

## Voxel UVs

Each voxel gets `box_uv: false`, `autouv: 0`, and all six faces map to the
single source texel:

```
uv = [imageX/sx, imageY/sy, (imageX+1)/sx, (imageY+1)/sy]
```

so every side of the voxel shows the same skin pixel, independent of the
layer face the voxel was generated from. Face `texture` is assigned by UUID,
the way Blockbench stores face textures at runtime.
