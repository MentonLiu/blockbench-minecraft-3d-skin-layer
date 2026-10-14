import { DEFAULT_OPTIONS, PLUGIN_ID } from '../domain/constants';
import { resolveGeneratorOptions } from '../domain/options';
import {
  collectLayerSnapshots,
  collectRestoreCandidates,
  hasOpenProject,
  isEditMode,
} from '../blockbench/compatibility';
import { collectRegenerationSources } from '../blockbench/modelRegenerator';
import { collectVoxelPixelRefs } from '../blockbench/transparentCleaner';
import { skinOperations } from '../operations/skinOperations';
import { toSkinOperationError } from '../operations/errors';
import type { GeneratorPreferences } from '../domain/types';
import type { SkinSize, SkinType, TemplateId } from '../newSkin/templates';
import {
  createSkinTemplateProject,
  isNewSkinFormatRegistered,
  waitForProjectTextures,
} from '../newSkin/newSkinFormat';
import type { IBlockbenchMcpApi, McpDispose, McpQueueEntry } from '../types/blockbench-mcp-api';

const TOOL_NAMES = [
  `${PLUGIN_ID}_inspect`,
  `${PLUGIN_ID}_generate`,
  `${PLUGIN_ID}_restore`,
  `${PLUGIN_ID}_regenerate`,
  `${PLUGIN_ID}_clear_transparent`,
  `${PLUGIN_ID}_new_skin`,
] as const;

let queueEntry: McpQueueEntry | undefined;
let activeApi: IBlockbenchMcpApi | undefined;
let activeDisposers: McpDispose[] = [];

function isSupportedVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return false;
  const [, majorText, minorText, patchText, prerelease] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (major !== 1 || prerelease) return false;
  return minor > 10 || (minor === 10 && patch >= 0);
}

function isCompatibleApi(api: IBlockbenchMcpApi): boolean {
  return (
    isSupportedVersion(api.version) &&
    typeof api.z?.object === 'function' &&
    typeof api.z?.enum === 'function' &&
    typeof api.z?.boolean === 'function' &&
    typeof api.z?.string === 'function' &&
    typeof api.z?.literal === 'function' &&
    typeof api.z?.union === 'function' &&
    typeof api.registerTool === 'function' &&
    typeof api.createJsonResult === 'function' &&
    typeof api.listTools === 'function'
  );
}

function safelyAvailable(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function hasLayers(): boolean {
  return hasOpenProject() && collectLayerSnapshots(resolveGeneratorOptions({})).length > 0;
}

function hasRestoreTargets(): boolean {
  return hasOpenProject() && collectRestoreCandidates().length > 0;
}

function hasRegenerationTargets(): boolean {
  return hasOpenProject() && collectRegenerationSources().length > 0;
}

function hasTransparentTargets(): boolean {
  return hasOpenProject() && collectVoxelPixelRefs().length > 0;
}

function inspectProject(): Record<string, unknown> {
  const projectOpen = hasOpenProject();
  const project = projectOpen && typeof Project !== 'undefined' ? Project : undefined;
  const layerCount = projectOpen ? collectLayerSnapshots(resolveGeneratorOptions({})).length : 0;
  const restoreCount = projectOpen ? collectRestoreCandidates().length : 0;
  const regenerateCount = projectOpen ? collectRegenerationSources().length : 0;
  const voxelCount = projectOpen ? collectVoxelPixelRefs().length : 0;
  const editMode = isEditMode();

  return {
    projectId: project && typeof project.uuid === 'string' ? project.uuid : null,
    projectName: project && typeof project.name === 'string' ? project.name : null,
    projectOpen,
    mode: editMode ? 'edit' : 'other',
    layerCount,
    generatedGroupCount: restoreCount,
    regeneratableGroupCount: regenerateCount,
    generatedVoxelCount: voxelCount,
    limits: {
      alphaThreshold: DEFAULT_OPTIONS.alphaThreshold,
      maxVoxels: DEFAULT_OPTIONS.maxVoxels,
      batchSize: DEFAULT_OPTIONS.batchSize,
    },
    availableOperations: {
      generate: projectOpen && editMode && layerCount > 0,
      restore: projectOpen && editMode && restoreCount > 0,
      regenerate: projectOpen && editMode && regenerateCount > 0,
      clearTransparent: projectOpen && editMode && voxelCount > 0,
      newSkin: isNewSkinFormatRegistered(),
    },
  };
}

function jsonResult(api: IBlockbenchMcpApi, value: Record<string, unknown>, isError = false) {
  const result = api.createJsonResult(value);
  return isError ? { ...result, isError: true } : result;
}

function errorResult(api: IBlockbenchMcpApi, error: unknown) {
  const normalized = toSkinOperationError(error);
  return jsonResult(api, {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  }, true);
}

async function executeSafely<T extends object>(
  api: IBlockbenchMcpApi,
  operation: () => Promise<T>,
) {
  try {
    const result = await operation();
    return jsonResult(api, { ok: true, result: result as unknown as Record<string, unknown> });
  } catch (error) {
    return errorResult(api, error);
  }
}

function disposeCurrentRegistration(): void {
  for (const dispose of activeDisposers.splice(0)) {
    try {
      dispose();
    } catch (error) {
      console.warn(`[${PLUGIN_ID}] Could not dispose an MCP tool registration.`, error);
    }
  }
  activeApi = undefined;
}

function setupTools(api: IBlockbenchMcpApi): void {
  if (!isCompatibleApi(api)) {
    console.warn(
      `[${PLUGIN_ID}] MCP tools require Blockbench MCP v1.10.0 or later in the 1.x series; found ${api.version}.`,
    );
    return;
  }
  if (activeApi === api && activeDisposers.length === TOOL_NAMES.length) return;
  disposeCurrentRegistration();

  const z = api.z;
  const projectEditCondition = (method: () => boolean) => ({ project: true, modes: ['edit'], method });
  const emptyParameters = z.object({}).strict();
  const generatorParameters = z.object({
    targetModel: z.enum(['current', 'copy']).default('current').describe('Modify the open project, or duplicate it first.'),
    preserveOriginal: z.boolean().default(false).describe('Keep the original layer cubes hidden instead of replacing them.'),
    replaceEmptyLayer: z.boolean().default(false).describe('Replace fully transparent source layers with empty generated groups.'),
    processSelectedOnly: z.boolean().default(false).describe('Process only selected layer cubes.'),
  }).strict();
  const restoreParameters = z.object({
    targetModel: z.enum(['current', 'copy']).default('current').describe('Restore in the open project, or duplicate it first.'),
  }).strict();
  const regenerateParameters = z.object({
    includeTransparent: z.boolean().default(false).describe('Generate cubes for transparent texels too.'),
  }).strict();
  const newSkinParameters = z.object({
    skinType: z.enum(['steve', 'alex']).default('steve').describe('Minecraft player skin arm type.'),
    template: z.enum(['root', 'classic', 'joint']).default('root').describe('The embedded model template.'),
    size: z.union([z.literal(64), z.literal(128)]).default(64).describe('Skin texture size in pixels.'),
    name: z.string().trim().min(1).max(128).optional().describe('Optional Blockbench project name.'),
    identifier: z.string().trim().min(1).max(128).optional().describe('Optional model identifier.'),
  }).strict();

  const registered: McpDispose[] = [];
  try {
    registered.push(api.registerTool({
      name: TOOL_NAMES[0],
      description: 'Inspect the current Blockbench project and report Minecraft 3D skin layer counts, fixed generation limits, and available operations.',
      parameters: emptyParameters,
      annotations: { title: 'Inspect 3D Skin Layers', readOnlyHint: true, idempotentHint: true },
      plugin: PLUGIN_ID,
      execute: () => {
        try {
          return jsonResult(api, { ok: true, result: inspectProject() });
        } catch (error) {
          return errorResult(api, error);
        }
      },
    }));
    registered.push(api.registerTool({
      name: TOOL_NAMES[1],
      description: 'Convert matching Minecraft skin layer cubes into per-pixel voxel cubes without opening a dialog.',
      parameters: generatorParameters,
      condition: projectEditCondition(() => safelyAvailable(hasLayers)),
      annotations: { title: 'Generate 3D Skin Layers', destructiveHint: true, idempotentHint: false },
      plugin: PLUGIN_ID,
      execute: (args, context) => executeSafely(api, async () => skinOperations.generate({
        options: args as Partial<GeneratorPreferences>,
        signal: context.signal,
      })),
    }));
    registered.push(api.registerTool({
      name: TOOL_NAMES[2],
      description: 'Restore generated voxel layers to their original layer cubes without opening a dialog.',
      parameters: restoreParameters,
      condition: projectEditCondition(() => safelyAvailable(hasRestoreTargets)),
      annotations: { title: 'Restore 3D Skin Layers', destructiveHint: true, idempotentHint: false },
      plugin: PLUGIN_ID,
      execute: (args, context) => executeSafely(api, async () => skinOperations.restore({
        options: args as Partial<GeneratorPreferences>,
        signal: context.signal,
      })),
    }));
    registered.push(api.registerTool({
      name: TOOL_NAMES[3],
      description: 'Rebuild existing generated voxel layers from their saved source geometry and current textures.',
      parameters: regenerateParameters,
      condition: projectEditCondition(() => safelyAvailable(hasRegenerationTargets)),
      annotations: { title: 'Regenerate 3D Skin Layers', destructiveHint: true, idempotentHint: false },
      plugin: PLUGIN_ID,
      execute: (args, context) => executeSafely(api, async () => skinOperations.regenerate({
        includeTransparent: args.includeTransparent,
        signal: context.signal,
      })),
    }));
    registered.push(api.registerTool({
      name: TOOL_NAMES[4],
      description: 'Remove generated voxel cubes whose referenced skin pixels are fully transparent.',
      parameters: emptyParameters,
      condition: projectEditCondition(() => safelyAvailable(hasTransparentTargets)),
      annotations: { title: 'Clear Transparent Skin Voxels', destructiveHint: true, idempotentHint: true },
      plugin: PLUGIN_ID,
      execute: (_args, context) => executeSafely(api, async () => skinOperations.clearTransparent({
        signal: context.signal,
      })),
    }));
    registered.push(api.registerTool({
      name: TOOL_NAMES[5],
      description: 'Create and voxelize a complete Steve or Alex 3D skin project from an embedded template.',
      parameters: newSkinParameters,
      condition: () => isNewSkinFormatRegistered(),
      annotations: { title: 'Create a 3D Skin Project', destructiveHint: false, idempotentHint: false },
      plugin: PLUGIN_ID,
      execute: (args, context) => executeSafely(api, async () => skinOperations.newSkin({
        skinType: args.skinType as SkinType,
        template: args.template as TemplateId,
        size: args.size as SkinSize,
        name: args.name,
        identifier: args.identifier,
        signal: context.signal,
        createTemplateProject: () => createSkinTemplateProject(args.skinType as SkinType, args.template as TemplateId, args.size as SkinSize),
        waitForTextures: waitForProjectTextures,
      })),
    }));
  } catch (error) {
    for (const dispose of registered.reverse()) {
      try {
        dispose();
      } catch {
        // Keep the original registration error; cleanup remains best effort.
      }
    }
    throw error;
  }

  activeApi = api;
  activeDisposers = registered;
}

/** Queue registration at plugin load so MCP may load before or after this plugin. */
export function registerMcpTools(): void {
  if (queueEntry) return;
  const entry: McpQueueEntry = {
    plugin: PLUGIN_ID,
    setup: setupTools,
  };
  try {
    if (globalThis.MCP_QUEUE !== undefined && !Array.isArray(globalThis.MCP_QUEUE)) {
      console.warn(`[${PLUGIN_ID}] MCP_QUEUE is not an array; skipping optional MCP registration.`);
      return;
    }
    (globalThis.MCP_QUEUE ??= []).push(entry);
    queueEntry = entry;
  } catch (error) {
    console.warn(`[${PLUGIN_ID}] Could not queue optional MCP tools; the regular plugin UI remains available.`, error);
  }
}

/** Remove registrations and any pending queue item when this plugin unloads. */
export function unregisterMcpTools(): void {
  disposeCurrentRegistration();
  // MCP replaces MCP_QUEUE with a live array whose push registers immediately.
  // Do not replace that live queue: MCP drops the retained owned entry when the
  // plugin unload event fires. A plain queue means MCP has not loaded yet.
  if (!globalThis.MCP && queueEntry && Array.isArray(globalThis.MCP_QUEUE)) {
    globalThis.MCP_QUEUE = globalThis.MCP_QUEUE.filter(entry => entry !== queueEntry);
  }
  queueEntry = undefined;
}

/** Small compatibility surface exported for unit tests and diagnostics. */
export const mcpToolRegistration = {
  isSupportedVersion,
  isCompatibleApi,
  toolNames: TOOL_NAMES,
};
