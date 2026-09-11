/** Small console logger with a stable prefix so warnings are greppable. */
export const logger = {
  info(message: string): void {
    console.info(`[${PLUGIN_NAME}] ${message}`);
  },
  warn(message: string): void {
    console.warn(`[${PLUGIN_NAME}] ${message}`);
  },
  error(message: string, error?: unknown): void {
    console.error(`[${PLUGIN_NAME}] ${message}`, error);
  },
};

const PLUGIN_NAME = 'minecraft_3d_skin_layers';
