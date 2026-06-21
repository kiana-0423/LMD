/* eslint-disable no-var */

type ProcessShim = {
  browser: boolean;
  env: Record<string, string | undefined>;
  pid: number;
  nextTick: (callback: () => void) => void;
  noDeprecation?: boolean;
  throwDeprecation?: boolean;
  traceDeprecation?: boolean;
  emitWarning?: (message: string) => void;
  stderr?: {
    isTTY?: boolean;
    columns?: number;
    getColorDepth?: () => number;
  };
};

declare global {
  var global: typeof globalThis | undefined;
  var process: ProcessShim | undefined;
  var Buffer: typeof Uint8Array | undefined;
}

const browserGlobal = globalThis;

browserGlobal.global = browserGlobal;
browserGlobal.Buffer = browserGlobal.Buffer ?? Uint8Array;
const processShim =
  browserGlobal.process ?? {
    browser: true,
    env: {},
    pid: 0,
    nextTick: (callback) => queueMicrotask(callback),
    emitWarning: (message) => console.warn(message),
    stderr: {
      isTTY: false,
      columns: 80,
      getColorDepth: () => 1
    }
  };

browserGlobal.process = processShim;
processShim.env = processShim.env ?? {};
processShim.env.NODE_ENV = processShim.env.NODE_ENV ?? (import.meta.env?.PROD ? "production" : "development");

export {};
