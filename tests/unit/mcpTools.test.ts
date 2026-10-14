import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PLUGIN_ID } from '../../src/domain/constants';
import { skinOperations } from '../../src/operations/skinOperations';
import { SkinOperationError } from '../../src/operations/errors';
import type { SkinOperationResult } from '../../src/operations/skinOperations';
import { mcpToolRegistration, registerMcpTools, unregisterMcpTools } from '../../src/mcp/registerTools';
import type { IBlockbenchMcpApi, McpToolOptions, McpQueueEntry } from '../../src/types/blockbench-mcp-api';

type ToolOptions = McpToolOptions;

function fakeApi(version = '1.10.0') {
  const tools = new Map<string, ToolOptions>();
  const api = {
    version,
    z,
    registerTool(options: ToolOptions) {
      tools.set(options.name, options);
      return () => { tools.delete(options.name); };
    },
    createJsonResult(value: Record<string, unknown>) {
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
    },
    listTools() {
      return [...tools.values()].map(tool => ({
        name: tool.name,
        description: tool.description,
        enabled: true,
        status: 'stable' as const,
        plugin: tool.plugin,
      }));
    },
    unregisterTool(name: string) { return tools.delete(name); },
    exposeAction() { return () => undefined; },
    runUndoableEdit<T>(_aspects: UndoAspects, _label: string, edit: () => T) { return edit(); },
  } as unknown as IBlockbenchMcpApi;
  return { api, tools };
}

function queuedSetup(): (api: IBlockbenchMcpApi) => void {
  const entry = globalThis.MCP_QUEUE?.[0];
  if (!entry || typeof entry === 'function') throw new Error('Expected an object MCP queue entry.');
  return entry.setup;
}

afterEach(() => {
  unregisterMcpTools();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MCP tool registration', () => {
  it('accepts the pinned API baseline and compatible stable 1.x upgrades only', () => {
    expect(mcpToolRegistration.isSupportedVersion('1.10.0')).toBe(true);
    expect(mcpToolRegistration.isSupportedVersion('v1.10.2')).toBe(true);
    expect(mcpToolRegistration.isSupportedVersion('1.9.9')).toBe(false);
    expect(mcpToolRegistration.isSupportedVersion('1.10.0-beta.1')).toBe(false);
    expect(mcpToolRegistration.isSupportedVersion('2.0.0')).toBe(false);
  });

  it('queues six strict tools with fixed generation parameters excluded', () => {
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const entry = globalThis.MCP_QUEUE?.[0] as Extract<McpQueueEntry, { setup: unknown }>;
    const { api, tools } = fakeApi();
    entry.setup(api);

    expect([...tools.keys()]).toEqual([
      `${PLUGIN_ID}_inspect`,
      `${PLUGIN_ID}_generate`,
      `${PLUGIN_ID}_restore`,
      `${PLUGIN_ID}_regenerate`,
      `${PLUGIN_ID}_clear_transparent`,
      `${PLUGIN_ID}_new_skin`,
    ]);
    expect(tools.get(`${PLUGIN_ID}_generate`)?.parameters?.parse({})).toEqual({
      targetModel: 'current',
      preserveOriginal: false,
      replaceEmptyLayer: false,
      processSelectedOnly: false,
    });
    expect(() => tools.get(`${PLUGIN_ID}_generate`)?.parameters?.parse({ maxVoxels: 500_000 })).toThrow();
    expect(() => tools.get(`${PLUGIN_ID}_clear_transparent`)?.parameters?.parse({ alphaThreshold: 128 })).toThrow();
    expect(tools.get(`${PLUGIN_ID}_new_skin`)?.parameters?.parse({})).toEqual({
      skinType: 'steve',
      template: 'root',
      size: 64,
    });

    unregisterMcpTools();
    expect(tools.size).toBe(0);
    expect(globalThis.MCP_QUEUE).toEqual([]);
  });

  it('skips an older or incompatible MCP API without preventing plugin load', () => {
    vi.stubGlobal('MCP_QUEUE', []);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerMcpTools();
    const setup = queuedSetup();
    const { api, tools } = fakeApi('1.9.9');
    setup(api);
    expect(tools.size).toBe(0);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('re-registers after MCP reload and removes registrations on plugin unload', () => {
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const setup = queuedSetup();
    const first = fakeApi();
    const second = fakeApi();

    setup(first.api);
    expect(first.tools.size).toBe(6);
    setup(second.api);
    expect(first.tools.size).toBe(0);
    expect(second.tools.size).toBe(6);
    unregisterMcpTools();
    expect(second.tools.size).toBe(0);
  });

  it('ignores retained setup callbacks after unload and a later plugin reload', () => {
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const staleSetup = queuedSetup();
    const first = fakeApi();
    staleSetup(first.api);

    unregisterMcpTools();
    staleSetup(first.api);
    expect(first.tools.size).toBe(0);

    registerMcpTools();
    const current = fakeApi();
    queuedSetup()(current.api);
    expect(current.tools.size).toBe(6);

    staleSetup(first.api);
    expect(first.tools.size).toBe(0);
    expect(current.tools.size).toBe(6);
  });

  it('disposes partial registrations and permits setup to retry after a failure', () => {
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const setup = queuedSetup();
    const { api, tools } = fakeApi();
    const register = api.registerTool.bind(api);
    const disposed: string[] = [];
    let attempts = 0;
    vi.spyOn(api, 'registerTool').mockImplementation(options => {
      if (++attempts === 3) throw new Error('registration failed');
      const dispose = register(options);
      return () => { disposed.push(options.name); dispose(); };
    });

    expect(() => setup(api)).toThrow('registration failed');
    expect(tools.size).toBe(0);
    expect(disposed).toEqual([
      `${PLUGIN_ID}_generate`,
      `${PLUGIN_ID}_inspect`,
    ]);

    setup(api);
    expect(tools.size).toBe(6);
    unregisterMcpTools();
    expect(tools.size).toBe(0);
  });

  it.each(['edit', 'paint', 'animate'])('keeps paint workflow tools available in %s mode', async mode => {
    const source = {
      uuid: 'layer-cube', name: 'Hat Layer', from: [0, 0, 0], to: [1, 1, 1],
      faces: { north: { texture: 'skin-texture', uv: [0, 0, 1, 1] } },
    };
    const voxel = {
      uuid: 'voxel-cube', type: 'cube', name: 'px_north_0_0', from: [0, 0, 0], to: [1, 1, 1],
      faces: { north: { texture: 'skin-texture', uv: [0, 0, 1, 1] } },
    };
    const group = {
      uuid: 'generated-group', name: 'Hat Layer', children: [voxel],
      m3sl_source: { schema: 1, source: { key: source.uuid, name: source.name, from: source.from, to: source.to, faces: [] } },
    };
    vi.stubGlobal('Project', { uuid: 'project-1', name: 'Skin' });
    vi.stubGlobal('Modes', { edit: mode === 'edit' });
    vi.stubGlobal('Cube', { all: [source, voxel] });
    vi.stubGlobal('Group', { all: [group] });
    vi.stubGlobal('Outliner', { root: [source, group] });
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const { api, tools } = fakeApi();
    queuedSetup()(api);

    for (const name of ['regenerate', 'clear_transparent']) {
      const condition = tools.get(`${PLUGIN_ID}_${name}`)?.condition;
      if (!condition || typeof condition !== 'object') throw new Error('Expected a project condition.');
      expect(condition.project).toBe(true);
      expect(condition.modes).toBeUndefined();
      expect(condition.method?.()).toBe(true);
    }
    for (const name of ['generate', 'restore']) {
      expect(tools.get(`${PLUGIN_ID}_${name}`)?.condition).toMatchObject({ modes: ['edit'] });
    }
    const inspect = tools.get(`${PLUGIN_ID}_inspect`)!;
    const response = await inspect.execute({}, { reportProgress: () => undefined });
    expect(response).toMatchObject({ structuredContent: { result: {
      availableOperations: {
        generate: mode === 'edit', restore: mode === 'edit', regenerate: true, clearTransparent: true,
      },
    } } });

    vi.stubGlobal('Group', { all: [] });
    for (const name of ['regenerate', 'clear_transparent']) {
      const condition = tools.get(`${PLUGIN_ID}_${name}`)?.condition;
      if (!condition || typeof condition !== 'object') throw new Error('Expected a project condition.');
      expect(condition.method?.()).toBe(false);
    }
    const emptyResponse = await inspect.execute({}, { reportProgress: () => undefined });
    expect(emptyResponse).toMatchObject({ structuredContent: { result: {
      availableOperations: { regenerate: false, clearTransparent: false },
    } } });
  });

  it('preserves the active MCP live queue when this plugin unloads', () => {
    const { api, tools } = fakeApi();
    const liveQueue: McpQueueEntry[] = [];
    const livePush = (...entries: McpQueueEntry[]) => {
      for (const entry of entries) {
        if (typeof entry !== 'function') entry.setup(api);
      }
      return liveQueue.length;
    };
    liveQueue.push = livePush;
    vi.stubGlobal('MCP', api);
    vi.stubGlobal('MCP_QUEUE', liveQueue);
    registerMcpTools();
    expect(tools.size).toBe(6);

    unregisterMcpTools();

    expect(globalThis.MCP_QUEUE).toBe(liveQueue);
    expect(globalThis.MCP_QUEUE?.push).toBe(livePush);
    expect(tools.size).toBe(0);
  });

  it('routes MCP calls through the shared operation service and forwards cancellation', async () => {
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const { api, tools } = fakeApi();
    queuedSetup()(api);
    const controller = new AbortController();
    const result: SkinOperationResult = {
      operation: 'generate',
      operationId: 'generate-1',
      status: 'completed',
      targetProjectId: 'project-1',
      sourceCount: 1,
      plannedCubes: 3,
      createdCubes: 3,
      createdGroups: 1,
      removedCubes: 0,
      restoredCubes: 0,
      replacedGroups: 0,
      durationMs: 5,
      warnings: [],
      copiedProject: false,
      templateProjectCreated: false,
      templateRetainedBare: false,
    };
    const generate = vi.spyOn(skinOperations, 'generate').mockResolvedValue(result);
    const tool = tools.get(`${PLUGIN_ID}_generate`);
    if (!tool) throw new Error('Generate tool was not registered.');
    const args = tool.parameters?.parse({ targetModel: 'copy', preserveOriginal: true });
    const response = await tool.execute(args, { reportProgress: () => undefined, signal: controller.signal });

    expect(generate).toHaveBeenCalledWith({
      options: {
        targetModel: 'copy',
        preserveOriginal: true,
        replaceEmptyLayer: false,
        processSelectedOnly: false,
      },
      signal: controller.signal,
    });
    expect(response).toMatchObject({ structuredContent: { ok: true, result } });
  });

  it('returns stable structured errors to MCP clients', async () => {
    vi.stubGlobal('MCP_QUEUE', []);
    registerMcpTools();
    const { api, tools } = fakeApi();
    queuedSetup()(api);
    vi.spyOn(skinOperations, 'restore').mockRejectedValue(new SkinOperationError('BUSY', 'busy'));
    const tool = tools.get(`${PLUGIN_ID}_restore`);
    if (!tool) throw new Error('Restore tool was not registered.');

    const response = await tool.execute(tool.parameters?.parse({}), { reportProgress: () => undefined });

    expect(response).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: 'BUSY', message: 'busy' } },
    });
  });
});
