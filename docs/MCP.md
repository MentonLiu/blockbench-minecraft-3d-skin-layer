# Blockbench MCP integration

Minecraft 3D Skin Layers can optionally register six tools with the public
extension API in Blockbench MCP v1.10.0 or a compatible later 1.x release. Install
both plugins in Blockbench Desktop and restart or reload them. The integration
does not run a second server. Web and PWA builds continue to use the regular
plugin UI when MCP is unavailable.

| Tool | Purpose | Arguments |
|---|---|---|
| `minecraft_3d_skin_layers_inspect` | Report the active project, layer and generated counts, fixed limits, and available operations | none |
| `minecraft_3d_skin_layers_generate` | Convert layer cubes to voxels | `targetModel`, `preserveOriginal`, `replaceEmptyLayer`, `processSelectedOnly` |
| `minecraft_3d_skin_layers_restore` | Restore original layer cubes | `targetModel` |
| `minecraft_3d_skin_layers_regenerate` | Rebuild generated voxels from current textures | `includeTransparent` |
| `minecraft_3d_skin_layers_clear_transparent` | Remove voxels whose source pixel is fully transparent | none |
| `minecraft_3d_skin_layers_new_skin` | Create a new Steve or Alex project | `skinType`, `template`, `size`, optional `name` and `identifier` |

All arguments are optional and default to the normal UI defaults. New skin
projects default to Steve, the Default model (`root`), and a 64px texture.
Schemas reject unknown fields. The engineering values alpha threshold `0`,
maximum `10,000` voxels, and batch size `200` are not exposed to MCP clients.

The tools call the same awaited operation service as the UI. A running write
holds the shared lock until it completes or rolls back; concurrent writes
return `BUSY`. MCP request cancellation is forwarded to the operation service.
Generate and restore require Edit mode. Regenerate and clear-transparent are
also available in Paint mode, matching the UI workflow for editing skin pixels.
Successful calls return structured counts and status. Errors return
`isError: true` and a stable code such as `NO_PROJECT`, `NO_TARGETS`,
`VOXEL_LIMIT`, `PROJECT_CHANGED`, or `CANCELLED`.

The plugin queues registration so either plugin can load first, checks the MCP
API version and required methods, and disposes its tools when unloaded. MCP
reloads re-register tools for plugins that remain loaded. See
[`TEST_PLAN.md`](TEST_PLAN.md) for disposable-project acceptance steps.

The registration uses the public API published by
[Blockbench MCP](https://github.com/jasonjgardner/blockbench-mcp-plugin/tree/d0271716c6434add875fd024e9ea6b474bc0ca09)
at commit `d0271716c6434add875fd024e9ea6b474bc0ca09`.
