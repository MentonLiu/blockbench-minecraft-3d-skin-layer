/** Minimal type surface based on Blockbench MCP's public API at d0271716c6434add875fd024e9ea6b474bc0ca09. */
import type { z as Zod } from 'zod';

export type McpDispose = () => void;

export interface McpToolContext {
  reportProgress(progress: { progress: number; total: number }): void;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface McpToolResult {
  content: Array<{ type: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpToolOptions<TSchema extends Zod.ZodTypeAny = Zod.ZodTypeAny> {
  name: string;
  description: string;
  parameters?: TSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  condition?: boolean | (() => boolean) | {
    modes?: string[];
    project?: boolean;
    method?: () => boolean;
  };
  plugin?: string;
  execute(args: Zod.infer<TSchema>, context: McpToolContext): string | McpToolResult | Promise<string | McpToolResult>;
}

export interface McpToolListing {
  name: string;
  description: string;
  enabled: boolean;
  status: 'stable' | 'experimental';
  plugin?: string;
}

export interface IBlockbenchMcpApi {
  readonly version: string;
  readonly z: typeof Zod;
  registerTool<TSchema extends Zod.ZodTypeAny = Zod.ZodTypeAny>(options: McpToolOptions<TSchema>): McpDispose;
  unregisterTool(name: string): boolean;
  listTools(): McpToolListing[];
  createJsonResult(result: Record<string, unknown>): McpToolResult;
}

export type McpQueueEntry = ((api: IBlockbenchMcpApi) => void) | {
  plugin: string;
  setup(api: IBlockbenchMcpApi): void;
};

declare global {
  var MCP: IBlockbenchMcpApi | undefined;
  var MCP_QUEUE: McpQueueEntry[] | undefined;
}
