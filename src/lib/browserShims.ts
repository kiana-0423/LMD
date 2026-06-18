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

type BrowserGlobal = typeof globalThis & {
  global?: typeof globalThis;
  process?: ProcessShim;
  Buffer?: typeof Uint8Array;
};

const browserGlobal = globalThis as BrowserGlobal;
const meta = import.meta as ImportMeta & { env?: { PROD?: boolean } };

browserGlobal.global = browserGlobal;
browserGlobal.Buffer = browserGlobal.Buffer ?? Uint8Array;
browserGlobal.process = browserGlobal.process ?? {
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

browserGlobal.process.env = browserGlobal.process.env ?? {};
browserGlobal.process.env.NODE_ENV =
  browserGlobal.process.env.NODE_ENV ?? (meta.env?.PROD ? "production" : "development");
