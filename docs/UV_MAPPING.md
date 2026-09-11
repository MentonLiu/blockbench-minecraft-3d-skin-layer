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

Voxels fill the layer's own shell: their grid tiles the **inflated box** (the
surface the original layer renders on) and their thickness equals `inflate`,
so the outer surface reproduces the original layer contour. A uniform
standoff (0.001) lifts the slab off the raw box surface:

```
north: z = [from.z - standoff - depth, from.z - standoff]      depth = inflate + eps
south: z = [to.z + standoff, to.z + standoff + depth]
east:  x = [to.x + standoff, to.x + standoff + depth]
west:  x = [from.x - standoff - depth, from.x - standoff]
up:    y = [to.y + standoff, to.y + standoff + depth]
down:  y = [from.y - standoff - depth, from.y - standoff]
```

### The per-direction epsilon (anti z-fighting)

Adjacent face grids share the inflated shell, so without countermeasures the
corner voxels of neighbouring directions produce coplanar duplicate faces
(severe shimmering). The planner gives every direction a tiny epsilon
(north 0, east 0.0015, south 0.003, west 0.0045, up 0.006, down 0.0075):

- the face grid box is **translated** by the epsilon (cells keep their exact
  texel size, but every grid line shifts), and
- the thickness gains the same epsilon.

Result: grid lines and shell planes of different directions sit 0.0015 apart
at the closest - the depth buffer never sees two coplanar faces inside a
part. The offsets are far below visual perception (max 0.009). Source cubes
from different parts may interpenetrate (the reference model's legs overlap
by 0.2 in the default pose); those shared planes are kept - cross-part
ghosting is accepted and disappears when the model is posed.

## Voxel UVs

Every voxel uses **per-face UV with all six faces mapped to the same source
texel**: each face carries the rectangle
`[imageX/sx, imageY/sy, (imageX+1)/sx, (imageY+1)/sy]` and the source face's
texture. The cube is created with `box_uv: false` and `autouv: 0`. Every
voxel copies source `origin` and `rotation` (rotation lives on the voxels,
never on the new Group).
