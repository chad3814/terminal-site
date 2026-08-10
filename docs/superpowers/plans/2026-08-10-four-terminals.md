# Four Resizable Terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js site showing four resizable terminal panes in a 2×2 grid, each a live local shell rendered by `@wterm/react` + `@wterm/ghostty` and backed by a dedicated tmux session that survives reloads.

**Architecture:** One WebSocket per pane → one PTY per socket → one tmux session per pane id (`tmux new-session -A -D -s termsite-N`). WebSocket frame type selects the channel: text frames are JSON control messages, binary frames are raw PTY bytes. A single CSS grid with a cross-shaped divider does the layout.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), npm, CSS Modules, `ws`, `node-pty`, `@wterm/react` + `@wterm/ghostty` 0.3.2, Vitest + jsdom + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-10-terminal-site-design.md`

## Global Constraints

These apply to every task. Do not restate them; do not violate them.

- **Never use the TypeScript `any` type.** Also avoid `unknown` — for JSON boundaries use the `JsonValue` type from Task 2. ESLint enforces `@typescript-eslint/no-explicit-any: error`.
- **2-space indents. Always terminate statements with semicolons**, including where optional.
- **Prefer async APIs over sync twins** — `fs.promises` over `fs.*Sync`, etc. Sync calls are acceptable only in Vitest test bodies and config files.
- **Never commit without explicit user approval. Never push.** Task steps say "Commit" — ask first, every time.
- Package manager is **npm**. Never `pnpm` or `yarn`.
- `@wterm/core`, `@wterm/dom`, `@wterm/react`, `@wterm/ghostty` are pinned to exactly **`0.3.2`**.
- All work happens in the worktree `/Users/cwalker/Projects/terminal-site/worktrees/four-terminals` on branch `feat/four-terminals`.
- The server binds **`127.0.0.1` only**. Never `0.0.0.0`.
- tmux session names are always prefixed **`termsite-`**.
- Definition of done for every task: `npm run lint`, `npm run type-check`, `npm test` all pass.

---

## File Structure

| File | Responsibility |
|---|---|
| `server.ts` | HTTP + Next + WebSocket upgrade routing. Wiring only. |
| `server/token.ts` | Per-process boot token, held on `globalThis`. |
| `server/auth.ts` | Origin allowlist, constant-time token compare. Pure. |
| `server/tmux.ts` | tmux argv/env construction, `PATH` lookup. Pure + one async fs call. |
| `server/pty-session.ts` | One PTY ↔ one socket, with injected deps for testing. |
| `shared/json.ts` | `JsonValue` type + object guard. Pure. |
| `shared/protocol.ts` | Control-message types, parse, serialize. Pure. Shared client/server. |
| `lib/split-layout.ts` | Split arithmetic and grid templates. Pure. |
| `lib/use-pty-socket.ts` | Hook owning one pane's WebSocket lifecycle. |
| `components/terminal-pane.tsx` | One core + one socket + one `<Terminal>` + status overlay. |
| `components/terminal-grid.tsx` | Split state, persistence, grid layout, four panes. |
| `components/split-divider.tsx` | Pointer drag + keyboard + ARIA separator. |
| `app/page.tsx` | Server Component; reads boot token, renders the grid. |
| `app/layout.tsx` | Root layout, mono font. |
| `public/ghostty-vt.wasm` | Vendored VT core, committed, guarded by a parity test. |
| `e2e/terminals.spec.ts` | Playwright: four shells, isolation, drag, reload persistence. |

---

### Task 1: Project scaffold, toolchain, vendored WASM

Sets up everything later tasks build on, and ships one real test: the guard that the committed `.wasm` matches the installed package.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `wterm-react.d.ts`, `test/setup.ts`, `test/wasm-parity.test.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `public/ghostty-vt.wasm`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm run lint` / `type-check` / `test` / `build`; path alias `@/*` → repo root.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "terminal-site",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "start": "NODE_ENV=production tsx server.ts",
    "lint": "eslint",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "postinstall": "chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper 2>/dev/null || true"
  },
  "dependencies": {
    "@wterm/core": "0.3.2",
    "@wterm/dom": "0.3.2",
    "@wterm/ghostty": "0.3.2",
    "@wterm/react": "0.3.2",
    "next": "^16.2.3",
    "node-pty": "^1.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "ws": "^8.18.2"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.0",
    "@next/eslint-plugin-next": "^16.2.3",
    "@playwright/test": "^1.50.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.10.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@types/ws": "^8.18.1",
    "eslint": "^9.39.0",
    "eslint-plugin-react-hooks": "^5.1.0",
    "globals": "^15.14.0",
    "jsdom": "^25.0.1",
    "tsx": "^4.19.4",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.20.0",
    "vitest": "^2.1.8"
  }
}
```

Note there is no `"type": "module"`. `tsx` therefore treats `.ts` as CommonJS, which makes extensionless relative imports work in `server.ts`.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["node", "vitest/globals"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "e2e"]
}
```

- [ ] **Step 3: Create `next.config.mjs`, `wterm-react.d.ts`, `.gitignore`**

`next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react", "@wterm/ghostty"],
  serverExternalPackages: ["node-pty"],
};

export default nextConfig;
```

`wterm-react.d.ts`:

```ts
declare module "@wterm/react/css";
```

`.gitignore`:

```
node_modules/
.next/
next-env.d.ts
*.tsbuildinfo
playwright-report/
test-results/
.DS_Store
```

- [ ] **Step 4: Create `eslint.config.mjs`**

Explicit plugin wiring rather than the `eslint-config-next` preset, so the config does not depend on that package's export shape.

```js
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
```

- [ ] **Step 5: Create `vitest.config.ts` and `test/setup.ts`**

One jsdom environment for everything. Node builtins (`node:crypto`, `node:fs`) remain available under jsdom, so the server tests run here too.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
  // tsconfig sets `jsx: "preserve"` because Next requires it. esbuild would then
  // emit JSX untransformed and every .tsx test would fail to parse, so override it
  // here rather than changing the tsconfig Next depends on.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
```

`test/setup.ts`. jsdom implements neither `PointerEvent` nor pointer capture, and
Task 8 drives a pointer drag, so both are polyfilled here once rather than per test:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

if (!("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
}

if (Element.prototype.setPointerCapture === undefined) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
}

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 6: Create a minimal app shell so `next build` succeeds**

`app/globals.css`:

```css
:root {
  --background: #0a0a0a;
  --foreground: #ededed;
  --divider: #2a2a2a;
  --divider-active: #4a4a4a;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-mono), ui-monospace, monospace;
}
```

`app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "terminal-site",
  description: "Four resizable local terminals",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={geistMono.variable}>
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` — placeholder, replaced in Task 12:

```tsx
export const dynamic = "force-dynamic";

export default function Page() {
  return <main>terminal-site</main>;
}
```

- [ ] **Step 7: Install dependencies and vendor the WASM binary**

```bash
npm install
mkdir -p public
cp node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm public/ghostty-vt.wasm
ls -l public/ghostty-vt.wasm
```

Expected: a file of roughly 400 KB. Only `ghostty-vt.wasm` is vendored — `wterm.wasm` (the built-in Zig core) is unused because `<Terminal core={...}>` ignores `wasmUrl`.

- [ ] **Step 8: Write the failing WASM parity test**

`test/wasm-parity.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const VENDORED = "public/ghostty-vt.wasm";
const INSTALLED = "node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm";

describe("vendored ghostty wasm", () => {
  it("is byte-identical to the installed @wterm/ghostty binary", async () => {
    const [vendored, installed] = await Promise.all([
      readFile(VENDORED),
      readFile(INSTALLED),
    ]);
    expect(vendored.equals(installed)).toBe(true);
  });

  it("is a real wasm module", async () => {
    const vendored = await readFile(VENDORED);
    expect([...vendored.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });
});
```

- [ ] **Step 9: Run the full gate, build first**

```bash
npm run build && npm run lint && npm run type-check && npm test
```

Build runs **first** on purpose: it generates `next-env.d.ts`, which supplies the
ambient type declarations for `*.module.css`. Without it, `type-check` fails on every
CSS Module import from Task 8 onward. Do not add your own `declare module
"*.module.css"` — it would collide with Next's.

Expected: all four pass, including the two WASM parity tests.

- [ ] **Step 10: Commit** *(ask for approval first)*

```bash
git add -A
git commit -m "Scaffold Next.js app with vendored ghostty WASM and test toolchain"
```

---

### Task 2: Control-message protocol

**Files:**
- Create: `shared/json.ts`, `shared/protocol.ts`, `shared/protocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type JsonValue`, `function isJsonObject(value: JsonValue): value is JsonObject`
  - `interface HelloMessage { type: "hello"; token: string; pane: number; cols: number; rows: number }`
  - `interface ResizeMessage { type: "resize"; cols: number; rows: number }`
  - `interface ReadyMessage { type: "ready" }`
  - `interface ErrorMessage { type: "error"; message: string }`
  - `type ClientMessage = HelloMessage | ResizeMessage`
  - `type ServerMessage = ReadyMessage | ErrorMessage`
  - `serializeMessage(msg: ClientMessage | ServerMessage): string`
  - `parseClientMessage(raw: string): ClientMessage | null`
  - `parseServerMessage(raw: string): ServerMessage | null`
  - `const PANE_COUNT = 4`

- [ ] **Step 1: Write `shared/json.ts`**

This exists so JSON boundaries never need `any` or `unknown`.

```ts
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse untrusted text into a JsonValue, or null if it is not valid JSON. */
export function parseJson(raw: string): JsonValue | null {
  try {
    const parsed: JsonValue = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write the failing protocol test**

`shared/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PANE_COUNT,
  parseClientMessage,
  parseServerMessage,
  serializeMessage,
} from "./protocol";

describe("serializeMessage", () => {
  it("round-trips a hello message", () => {
    const raw = serializeMessage({
      type: "hello",
      token: "abc",
      pane: 0,
      cols: 80,
      rows: 24,
    });
    expect(parseClientMessage(raw)).toEqual({
      type: "hello",
      token: "abc",
      pane: 0,
      cols: 80,
      rows: 24,
    });
  });

  it("round-trips a resize message", () => {
    const raw = serializeMessage({ type: "resize", cols: 100, rows: 30 });
    expect(parseClientMessage(raw)).toEqual({ type: "resize", cols: 100, rows: 30 });
  });

  it("round-trips server messages", () => {
    expect(parseServerMessage(serializeMessage({ type: "ready" }))).toEqual({
      type: "ready",
    });
    expect(
      parseServerMessage(serializeMessage({ type: "error", message: "nope" })),
    ).toEqual({ type: "error", message: "nope" });
  });
});

describe("parseClientMessage", () => {
  it("rejects malformed and hostile input", () => {
    expect(parseClientMessage("")).toBeNull();
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage("[]")).toBeNull();
    expect(parseClientMessage("null")).toBeNull();
    expect(parseClientMessage('"hello"')).toBeNull();
    expect(parseClientMessage('{"type":"nope"}')).toBeNull();
    expect(parseClientMessage('{"type":"ready"}')).toBeNull();
  });

  it("rejects a hello with a bad pane index", () => {
    const bad = (pane: number): string =>
      JSON.stringify({ type: "hello", token: "t", pane, cols: 80, rows: 24 });
    expect(parseClientMessage(bad(-1))).toBeNull();
    expect(parseClientMessage(bad(PANE_COUNT))).toBeNull();
    expect(parseClientMessage(bad(1.5))).toBeNull();
  });

  it("rejects non-integer and out-of-range dimensions", () => {
    expect(
      parseClientMessage('{"type":"resize","cols":0,"rows":24}'),
    ).toBeNull();
    expect(
      parseClientMessage('{"type":"resize","cols":80,"rows":100000}'),
    ).toBeNull();
    expect(
      parseClientMessage('{"type":"resize","cols":"80","rows":24}'),
    ).toBeNull();
  });

  it("rejects a hello with a non-string token", () => {
    expect(
      parseClientMessage('{"type":"hello","token":5,"pane":0,"cols":80,"rows":24}'),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run shared/protocol.test.ts
```

Expected: FAIL — cannot resolve `./protocol`.

- [ ] **Step 4: Write `shared/protocol.ts`**

```ts
import { isJsonObject, parseJson, type JsonObject, type JsonValue } from "./json";

export const PANE_COUNT = 4;

const MIN_DIMENSION = 1;
const MAX_DIMENSION = 10_000;

export interface HelloMessage {
  type: "hello";
  token: string;
  pane: number;
  cols: number;
  rows: number;
}

export interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export interface ReadyMessage {
  type: "ready";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ClientMessage = HelloMessage | ResizeMessage;
export type ServerMessage = ReadyMessage | ErrorMessage;

export function serializeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function isDimension(value: JsonValue | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_DIMENSION &&
    value <= MAX_DIMENSION
  );
}

function isPaneIndex(value: JsonValue | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < PANE_COUNT
  );
}

function asObject(raw: string): JsonObject | null {
  const parsed = parseJson(raw);
  if (parsed === null) return null;
  return isJsonObject(parsed) ? parsed : null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  if (obj.type === "hello") {
    if (typeof obj.token !== "string") return null;
    if (!isPaneIndex(obj.pane)) return null;
    if (!isDimension(obj.cols) || !isDimension(obj.rows)) return null;
    return {
      type: "hello",
      token: obj.token,
      pane: obj.pane,
      cols: obj.cols,
      rows: obj.rows,
    };
  }

  if (obj.type === "resize") {
    if (!isDimension(obj.cols) || !isDimension(obj.rows)) return null;
    return { type: "resize", cols: obj.cols, rows: obj.rows };
  }

  return null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  if (obj.type === "ready") return { type: "ready" };

  if (obj.type === "error") {
    if (typeof obj.message !== "string") return null;
    return { type: "error", message: obj.message };
  }

  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run shared/protocol.test.ts && npm run lint && npm run type-check
```

Expected: PASS, clean lint and types.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add shared/
git commit -m "Add typed WebSocket control-message protocol"
```

---

### Task 3: tmux argv, environment, and lookup

**Files:**
- Create: `server/tmux.ts`, `server/tmux.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const TMUX_SESSION_PREFIX = "termsite-"`
  - `tmuxSessionName(pane: number): string`
  - `tmuxArgs(pane: number): string[]`
  - `tmuxEnv(source: Record<string, string | undefined>): Record<string, string>`
  - `findTmux(pathEnv: string | undefined): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

`server/tmux.test.ts`:

```ts
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findTmux, tmuxArgs, tmuxEnv, tmuxSessionName } from "./tmux";

const createdDirs: string[] = [];

describe("tmuxSessionName", () => {
  it("prefixes the pane index so it cannot collide with user sessions", () => {
    expect(tmuxSessionName(0)).toBe("termsite-0");
    expect(tmuxSessionName(3)).toBe("termsite-3");
  });
});

describe("tmuxArgs", () => {
  it("attaches-or-creates and detaches other clients", () => {
    expect(tmuxArgs(2)).toEqual([
      "new-session",
      "-A",
      "-D",
      "-s",
      "termsite-2",
    ]);
  });
});

describe("tmuxEnv", () => {
  it("strips TMUX so a nested tmux does not refuse to launch", () => {
    const env = tmuxEnv({ TMUX: "/tmp/sock,123,0", TMUX_PANE: "%4", HOME: "/h" });
    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
    expect(env.HOME).toBe("/h");
  });

  it("pins TERM and drops undefined values", () => {
    const env = tmuxEnv({ TERM: "dumb", NOPE: undefined });
    expect(env.TERM).toBe("xterm-256color");
    expect("NOPE" in env).toBe(false);
  });
});

describe("findTmux", () => {
  afterEach(async () => {
    for (const dir of createdDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        // Ignore errors if directory was already cleaned or doesn't exist
      });
    }
    createdDirs.length = 0;
  });

  it("returns null when PATH is empty or unset", async () => {
    await expect(findTmux(undefined)).resolves.toBeNull();
    await expect(findTmux("")).resolves.toBeNull();
  });

  it("finds an executable tmux on PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmux-probe-"));
    createdDirs.push(dir);
    const bin = join(dir, "tmux");
    await writeFile(bin, "#!/bin/sh\nexit 0\n");
    await chmod(bin, 0o755);
    await expect(findTmux(`/nonexistent:${dir}`)).resolves.toBe(bin);
  });

  it("ignores a non-executable file named tmux", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmux-probe-"));
    createdDirs.push(dir);
    const bin = join(dir, "tmux");
    await writeFile(bin, "not executable");
    await chmod(bin, 0o644);
    await expect(findTmux(dir)).resolves.toBeNull();
  });

  it("ignores a directory named tmux even if executable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmux-probe-"));
    createdDirs.push(dir);
    const tmuxDir = join(dir, "tmux");
    await mkdir(tmuxDir, { mode: 0o755 });
    await expect(findTmux(dir)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run server/tmux.test.ts
```

Expected: FAIL — cannot resolve `./tmux`.

- [ ] **Step 3: Write `server/tmux.ts`**

Uses `fs.promises.access` rather than spawning `which`, per the async-API constraint.

```ts
import { access, constants, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const TMUX_SESSION_PREFIX = "termsite-";

export function tmuxSessionName(pane: number): string {
  return `${TMUX_SESSION_PREFIX}${pane}`;
}

/**
 * `-A` attaches to the session if it exists and creates it otherwise.
 * `-D` detaches any other client first, so the browser pane always owns
 * sizing — tmux otherwise sizes a session to its smallest attached client.
 */
export function tmuxArgs(pane: number): string[] {
  return ["new-session", "-A", "-D", "-s", tmuxSessionName(pane)];
}

/**
 * `TMUX` must be stripped: if the dev server was started from inside a tmux
 * session the child inherits it and nested tmux refuses to launch.
 */
export function tmuxEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.TMUX;
  delete env.TMUX_PANE;
  env.TERM = "xterm-256color";
  return env;
}

export async function findTmux(pathEnv: string | undefined): Promise<string | null> {
  if (pathEnv === undefined || pathEnv === "") return null;

  for (const dir of pathEnv.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "tmux");
    try {
      const stats = await stat(candidate);
      if (!stats.isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run server/tmux.test.ts && npm run lint && npm run type-check
```

Expected: PASS.

- [ ] **Step 5: Commit** *(ask for approval first)*

```bash
git add server/tmux.ts server/tmux.test.ts
git commit -m "Add tmux argv, environment, and PATH lookup helpers"
```

---

### Task 4: Origin allowlist and boot token

**Files:**
- Create: `server/auth.ts`, `server/auth.test.ts`, `server/token.ts`, `server/token.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `allowedOrigins(port: number): string[]`
  - `isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean`
  - `isTokenValid(provided: string, expected: string): boolean`
  - `bootToken(): string`

- [ ] **Step 1: Write the failing auth test**

`server/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allowedOrigins, isOriginAllowed, isTokenValid } from "./auth";

describe("allowedOrigins", () => {
  it("derives both loopback spellings from the configured port", () => {
    expect(allowedOrigins(3000)).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ]);
  });

  it("tracks a non-default port so PORT cannot lock the app out", () => {
    expect(allowedOrigins(4100)).toEqual([
      "http://127.0.0.1:4100",
      "http://localhost:4100",
    ]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = allowedOrigins(3000);

  it("accepts an exact loopback origin", () => {
    expect(isOriginAllowed("http://127.0.0.1:3000", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
  });

  it("rejects a missing origin", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(false);
    expect(isOriginAllowed("", allowed)).toBe(false);
  });

  it("rejects other origins, ports, and schemes", () => {
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:3001", allowed)).toBe(false);
    expect(isOriginAllowed("https://localhost:3000", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:3000.evil.example", allowed)).toBe(false);
  });
});

describe("isTokenValid", () => {
  it("accepts an exact match", () => {
    expect(isTokenValid("s3cret", "s3cret")).toBe(true);
  });

  it("rejects wrong values and wrong lengths without throwing", () => {
    expect(isTokenValid("s3cret", "s3cres")).toBe(false);
    expect(isTokenValid("", "s3cret")).toBe(false);
    expect(isTokenValid("s3cret-and-then-some", "s3cret")).toBe(false);
  });

  describe("timing-safe comparison pinning", () => {
    it("implements length guard before timing-safe comparison", () => {
      // crypto.timingSafeEqual throws if buffers have different lengths.
      // This test verifies the length guard works: if isTokenValid returns false
      // instead of throwing, the length check is in place.
      const result = isTokenValid("x", "much-longer");
      expect(result).toBe(false);
    });

    it("compares with crypto.timingSafeEqual, not a short-circuiting operator", async () => {
      // Timing-safe comparison cannot be observed through return values alone:
      // both crypto.timingSafeEqual and === return identical booleans for the
      // same inputs. This test pins the security property by asserting on the
      // implementation itself — the only honest way to verify *which function*
      // is being called. This coupling is justified precisely because the
      // security property lives in the call site, not in the result.
      const { readFile } = await import("node:fs/promises");
      const source = await readFile("server/auth.ts", "utf8");
      expect(source).toMatch(
        /import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*["']node:crypto["']/,
      );
      const body = source.slice(source.indexOf("export function isTokenValid"));
      expect(body).toContain("timingSafeEqual(");
      expect(body).not.toMatch(/provided\s*===\s*expected/);
    });
  });
});
```

- [ ] **Step 2: Write the failing token test**

`server/token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bootToken } from "./token";

describe("bootToken", () => {
  it("is stable within a process", () => {
    expect(bootToken()).toBe(bootToken());
  });

  it("is a long base64url string", () => {
    expect(bootToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
npx vitest run server/auth.test.ts server/token.test.ts
```

Expected: FAIL — cannot resolve `./auth` and `./token`.

- [ ] **Step 4: Write `server/auth.ts`**

```ts
import { timingSafeEqual } from "node:crypto";

/**
 * The allowlist is derived from the configured port rather than hardcoded,
 * so setting PORT cannot lock the app out of its own WebSocket.
 */
export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

export function isOriginAllowed(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined || origin === "") return false;
  return allowed.includes(origin);
}

export function isTokenValid(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 5: Write `server/token.ts`**

The token is held on `globalThis` under a `Symbol.for` key rather than in module
scope. Next compiles Server Components through its own module registry, so
`app/page.tsx` and `server.ts` can otherwise end up with two separate instances of
this module — and two different tokens, which would make every socket fail auth.

```ts
import { randomBytes } from "node:crypto";

const BOOT_TOKEN_KEY = Symbol.for("terminal-site.boot-token");

type TokenHolder = { [BOOT_TOKEN_KEY]?: string };

export function bootToken(): string {
  const holder = globalThis as typeof globalThis & TokenHolder;
  let token = holder[BOOT_TOKEN_KEY];
  if (token === undefined) {
    token = randomBytes(32).toString("base64url");
    holder[BOOT_TOKEN_KEY] = token;
  }
  return token;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run server/auth.test.ts server/token.test.ts && npm run lint && npm run type-check
```

Expected: PASS.

- [ ] **Step 7: Commit** *(ask for approval first)*

```bash
git add server/auth.ts server/auth.test.ts server/token.ts server/token.test.ts
git commit -m "Add origin allowlist and per-process boot token"
```

---

### Task 5: PTY session bridge

The heart of the server. Dependencies are injected so the whole lifecycle is unit-testable without spawning a real shell.

**Files:**
- Create: `server/pty-session.ts`, `server/pty-session.test.ts`

**Interfaces:**
- Consumes: `parseClientMessage`, `serializeMessage` (Task 2); `tmuxArgs` (Task 3); `isTokenValid` (Task 4).
- Produces:
  - `interface SessionSocket { send(data: string | Uint8Array): void; close(): void; onMessage(h: (data: Buffer, isBinary: boolean) => void): void; onClose(h: () => void): void }`
  - `interface PtyHandle { onData(cb: (data: string) => void): void; onExit(cb: () => void): void; write(data: string): void; resize(cols: number, rows: number): void; kill(): void }`
  - `interface SpawnPtyArgs { file: string; args: string[]; cols: number; rows: number; cwd: string; env: Record<string, string> }`
  - `type SpawnPty = (args: SpawnPtyArgs) => PtyHandle`
  - `interface PtySessionDeps { socket: SessionSocket; expectedToken: string; tmuxPath: string | null; spawn: SpawnPty; env: Record<string, string>; cwd: string; helloTimeoutMs?: number }`
  - `attachPtySession(deps: PtySessionDeps): void`
  - `const HELLO_TIMEOUT_MS = 5000`

- [ ] **Step 1: Write the failing test**

`server/pty-session.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import {
  attachPtySession,
  type PtyHandle,
  type SessionSocket,
  type SpawnPty,
  type SpawnPtyArgs,
} from "./pty-session";

const TOKEN = "correct-token";

interface FakeSocket extends SessionSocket {
  sent: (string | Uint8Array)[];
  closed: boolean;
  emitText(text: string): void;
  emitBinary(bytes: Uint8Array): void;
  emitClose(): void;
}

function makeSocket(): FakeSocket {
  let onMessage: ((data: Buffer, isBinary: boolean) => void) | null = null;
  let onClose: (() => void) | null = null;
  return {
    sent: [],
    closed: false,
    send(data) {
      this.sent.push(data);
    },
    close() {
      // A real WebSocket fires its own "close" event whenever close() is
      // called, whether the call originated locally or remotely, and it
      // only fires once. Mirror that so the exit -> close -> kill feedback
      // loop this module creates is actually exercised by the fakes.
      if (this.closed) return;
      this.closed = true;
      onClose?.();
    },
    onMessage(handler) {
      onMessage = handler;
    },
    onClose(handler) {
      onClose = handler;
    },
    emitText(text) {
      onMessage?.(Buffer.from(text, "utf8"), false);
    },
    emitBinary(bytes) {
      onMessage?.(Buffer.from(bytes), true);
    },
    emitClose() {
      this.close();
    },
  };
}

interface FakePty extends PtyHandle {
  written: string[];
  resizes: [number, number][];
  killed: boolean;
  emitData(data: string): void;
  emitExit(): void;
}

function makePty(): FakePty {
  let onData: ((data: string) => void) | null = null;
  let onExit: (() => void) | null = null;
  return {
    written: [],
    resizes: [],
    killed: false,
    onData(cb) {
      onData = cb;
    },
    onExit(cb) {
      onExit = cb;
    },
    write(data) {
      this.written.push(data);
    },
    resize(cols, rows) {
      this.resizes.push([cols, rows]);
    },
    kill() {
      this.killed = true;
    },
    emitData(data) {
      onData?.(data);
    },
    emitExit() {
      onExit?.();
    },
  };
}

function textFrames(socket: FakeSocket): string[] {
  return socket.sent.filter((frame): frame is string => typeof frame === "string");
}

let socket: FakeSocket;
let pty: FakePty;
let spawnArgs: SpawnPtyArgs[];
let spawn: SpawnPty;

beforeEach(() => {
  socket = makeSocket();
  pty = makePty();
  spawnArgs = [];
  spawn = (args) => {
    spawnArgs.push(args);
    return pty;
  };
});

function attach(overrides: Partial<Parameters<typeof attachPtySession>[0]> = {}): void {
  attachPtySession({
    socket,
    expectedToken: TOKEN,
    tmuxPath: "/usr/bin/tmux",
    spawn,
    env: { HOME: "/home/test" },
    cwd: "/home/test",
    ...overrides,
  });
}

function hello(token = TOKEN, pane = 1): string {
  return serializeMessage({ type: "hello", token, pane, cols: 80, rows: 24 });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("attachPtySession", () => {
  it("spawns tmux with attach-or-create args on a valid hello", () => {
    attach();
    socket.emitText(hello());

    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.file).toBe("/usr/bin/tmux");
    expect(spawnArgs[0]?.args).toEqual([
      "new-session",
      "-A",
      "-D",
      "-s",
      "termsite-1",
    ]);
    expect(spawnArgs[0]?.cols).toBe(80);
    expect(spawnArgs[0]?.rows).toBe(24);
    expect(textFrames(socket)).toContain(serializeMessage({ type: "ready" }));
  });

  it("refuses a bad token without spawning anything", () => {
    attach();
    socket.emitText(hello("wrong-token"));

    expect(spawnArgs).toHaveLength(0);
    expect(socket.closed).toBe(true);
    expect(textFrames(socket)[0]).toContain("unauthorized");
  });

  it("reports a readable error when tmux is missing", () => {
    attach({ tmuxPath: null });
    socket.emitText(hello());

    expect(spawnArgs).toHaveLength(0);
    expect(textFrames(socket)[0]).toContain("tmux not found on PATH");
    expect(socket.closed).toBe(true);
  });

  it("closes the socket when no hello arrives in time", () => {
    vi.useFakeTimers();
    attach({ helloTimeoutMs: 5000 });
    vi.advanceTimersByTime(5001);
    expect(socket.closed).toBe(true);
    expect(spawnArgs).toHaveLength(0);
  });

  it("ignores input and resize before a hello", () => {
    attach();
    socket.emitBinary(new TextEncoder().encode("ls\n"));
    socket.emitText(serializeMessage({ type: "resize", cols: 10, rows: 10 }));
    expect(pty.written).toEqual([]);
    expect(pty.resizes).toEqual([]);
  });

  it("forwards binary input to the pty and pty output back as binary", () => {
    attach();
    socket.emitText(hello());
    socket.emitBinary(new TextEncoder().encode("echo hi\n"));
    expect(pty.written).toEqual(["echo hi\n"]);

    pty.emitData("hi\r\n");
    const binary = socket.sent.filter((f): f is Uint8Array => typeof f !== "string");
    expect(binary).toHaveLength(1);
    expect(new TextDecoder().decode(binary[0])).toBe("hi\r\n");
  });

  it("forwards resize after hello", () => {
    attach();
    socket.emitText(hello());
    socket.emitText(serializeMessage({ type: "resize", cols: 120, rows: 40 }));
    expect(pty.resizes).toEqual([[120, 40]]);
  });

  it("ignores malformed control frames instead of crashing", () => {
    attach();
    socket.emitText(hello());
    socket.emitText("{not json");
    socket.emitText('{"type":"resize","cols":-5,"rows":10}');
    expect(pty.resizes).toEqual([]);
  });

  it("kills the pty when the socket closes, leaving the tmux session alive", () => {
    attach();
    socket.emitText(hello());
    socket.emitClose();
    expect(pty.killed).toBe(true);
  });

  it("closes the socket when the pty exits", () => {
    attach();
    socket.emitText(hello());
    pty.emitExit();
    expect(socket.closed).toBe(true);
  });

  it("does not kill an already-exited pty when the exit triggers socket close", () => {
    attach();
    socket.emitText(hello());
    pty.emitExit();
    expect(socket.closed).toBe(true);
    expect(pty.killed).toBe(false);
  });

  it("does not send pty output that arrives after teardown", () => {
    attach();
    socket.emitText(hello());
    const framesBeforeExit = socket.sent.length;
    pty.emitExit();
    pty.emitData("late output");
    expect(socket.sent.length).toBe(framesBeforeExit);
  });

  it("ignores a second hello", () => {
    attach();
    socket.emitText(hello());
    socket.emitText(hello());
    expect(spawnArgs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run server/pty-session.test.ts
```

Expected: FAIL — cannot resolve `./pty-session`.

- [ ] **Step 3: Write `server/pty-session.ts`**

```ts
import { parseClientMessage, serializeMessage } from "@/shared/protocol";
import { isTokenValid } from "./auth";
import { tmuxArgs } from "./tmux";

export const HELLO_TIMEOUT_MS = 5000;

export interface SessionSocket {
  send(data: string | Uint8Array): void;
  close(): void;
  onMessage(handler: (data: Buffer, isBinary: boolean) => void): void;
  onClose(handler: () => void): void;
}

export interface PtyHandle {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface SpawnPtyArgs {
  file: string;
  args: string[];
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export type SpawnPty = (args: SpawnPtyArgs) => PtyHandle;

export interface PtySessionDeps {
  socket: SessionSocket;
  expectedToken: string;
  tmuxPath: string | null;
  spawn: SpawnPty;
  env: Record<string, string>;
  cwd: string;
  helloTimeoutMs?: number;
}

export function attachPtySession(deps: PtySessionDeps): void {
  const { socket, expectedToken, tmuxPath, spawn, env, cwd } = deps;
  const helloTimeoutMs = deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS;

  let pty: PtyHandle | null = null;
  let settled = false;
  let tornDown = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      socket.close();
    }
  }, helloTimeoutMs);

  function fail(message: string): void {
    settled = true;
    clearTimeout(timer);
    socket.send(serializeMessage({ type: "error", message }));
    socket.close();
  }

  function start(pane: number, cols: number, rows: number): void {
    if (tmuxPath === null) {
      fail("tmux not found on PATH — install tmux to use terminal-site");
      return;
    }

    settled = true;
    clearTimeout(timer);

    const handle = spawn({
      file: tmuxPath,
      args: tmuxArgs(pane),
      cols,
      rows,
      cwd,
      env,
    });

    handle.onData((data) => {
      if (tornDown) return;
      socket.send(Buffer.from(data, "utf8"));
    });

    handle.onExit(() => {
      // The process is already gone — drop the handle so teardown does not
      // kill a dead pid, which can throw ESRCH inside the close handler.
      pty = null;
      tornDown = true;
      socket.close();
    });

    pty = handle;
    socket.send(serializeMessage({ type: "ready" }));
  }

  socket.onMessage((data, isBinary) => {
    if (isBinary) {
      if (pty !== null) pty.write(data.toString("utf8"));
      return;
    }

    const msg = parseClientMessage(data.toString("utf8"));
    if (msg === null) return;

    if (msg.type === "hello") {
      if (settled) return;
      if (!isTokenValid(msg.token, expectedToken)) {
        fail("unauthorized");
        return;
      }
      start(msg.pane, msg.cols, msg.rows);
      return;
    }

    if (pty !== null) pty.resize(msg.cols, msg.rows);
  });

  socket.onClose(() => {
    clearTimeout(timer);
    tornDown = true;
    const handle = pty;
    pty = null;
    // Killing the PTY detaches the tmux client. The session survives.
    if (handle !== null) handle.kill();
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run server/pty-session.test.ts && npm run lint && npm run type-check
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit** *(ask for approval first)*

```bash
git add server/pty-session.ts server/pty-session.test.ts
git commit -m "Add PTY session bridge with injected dependencies"
```

---

### Task 6: Custom server wiring

No new unit tests — this file is pure wiring over tested parts, and Task 13's Playwright suite exercises it end to end. Verified here by starting it and completing a real handshake.

**Files:**
- Create: `server.ts`

**Interfaces:**
- Consumes: `attachPtySession`, `SessionSocket`, `SpawnPtyArgs` (Task 5); `allowedOrigins`, `isOriginAllowed` (Task 4); `findTmux`, `tmuxEnv` (Task 3); `bootToken` (Task 4).
- Produces: an HTTP server on `127.0.0.1:${PORT ?? 3000}` serving Next and accepting WebSocket upgrades at `/api/terminal`.

- [ ] **Step 1: Write `server.ts`**

```ts
import { createServer } from "node:http";
import { homedir } from "node:os";
import { parse } from "node:url";
import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { allowedOrigins, isOriginAllowed } from "./server/auth";
import { attachPtySession, type SessionSocket } from "./server/pty-session";
import { findTmux, tmuxEnv } from "./server/tmux";
import { bootToken } from "./server/token";

const dev = process.env.NODE_ENV !== "production";
const hostname = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function toSessionSocket(ws: WebSocket): SessionSocket {
  return {
    send(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close() {
      ws.close();
    },
    onMessage(handler) {
      ws.on("message", (data: RawData, isBinary: boolean) => {
        handler(toBuffer(data), isBinary);
      });
    },
    onClose(handler) {
      ws.on("close", handler);
    },
  };
}

async function main(): Promise<void> {
  await app.prepare();

  const tmuxPath = await findTmux(process.env.PATH);
  if (tmuxPath === null) {
    console.warn("tmux not found on PATH — panes will report an error until it is installed");
  }

  const origins = allowedOrigins(port);
  const env = tmuxEnv(process.env);
  const cwd = process.env.HOME ?? homedir();
  const token = bootToken();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url ?? "/", true));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/", true);

    if (pathname !== "/api/terminal") {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }

    if (!isOriginAllowed(req.headers.origin, origins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachPtySession({
        socket: toSessionSocket(ws),
        expectedToken: token,
        tmuxPath,
        spawn: (args) =>
          pty.spawn(args.file, args.args, {
            name: "xterm-256color",
            cols: args.cols,
            rows: args.rows,
            cwd: args.cwd,
            env: args.env,
          }),
        env,
        cwd,
      });
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> terminal-site ready on http://${hostname}:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

Note `main().catch((error: unknown) => ...)` — a catch parameter is the one place `unknown` is unavoidable, and it is safer than `any` there.

- [ ] **Step 2: Verify the server boots and rejects a bad origin**

```bash
npm run dev
```

In a second shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: https://evil.example' \
  http://127.0.0.1:3000/api/terminal
```

Expected: `200` then `403`. Stop the dev server.

- [ ] **Step 3: Run the gate**

```bash
npm run lint && npm run type-check && npm test
```

Expected: all pass.

- [ ] **Step 4: Commit** *(ask for approval first)*

```bash
git add server.ts
git commit -m "Add custom Next server with origin-guarded WebSocket upgrades"
```

---

### Task 7: Split layout arithmetic

**Files:**
- Create: `lib/split-layout.ts`, `lib/split-layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const MIN_SPLIT_PERCENT = 10`, `MAX_SPLIT_PERCENT = 90`, `DIVIDER_SIZE_PX = 6`, `SPLIT_STORAGE_KEY = "terminal-site.split"`
  - `interface SplitState { col: number; row: number }`
  - `const DEFAULT_SPLIT: SplitState`
  - `clampSplit(percent: number): number`
  - `splitFromPointer(pointer: number, containerStart: number, containerSize: number): number`
  - `nudgeSplit(percent: number, delta: number): number`
  - `gridTemplate(percent: number): string`
  - `parseStoredSplit(raw: string | null): SplitState`
  - `serializeSplit(split: SplitState): string`

- [ ] **Step 1: Write the failing test**

`lib/split-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT,
  clampSplit,
  gridTemplate,
  nudgeSplit,
  parseStoredSplit,
  serializeSplit,
  splitFromPointer,
} from "./split-layout";

describe("clampSplit", () => {
  it("clamps to the 10-90 range", () => {
    expect(clampSplit(50)).toBe(50);
    expect(clampSplit(0)).toBe(10);
    expect(clampSplit(100)).toBe(90);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_SPLIT.col);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(90);
  });
});

describe("splitFromPointer", () => {
  it("converts a pointer position into a percentage", () => {
    expect(splitFromPointer(250, 0, 1000)).toBe(25);
    expect(splitFromPointer(700, 200, 1000)).toBe(50);
  });

  it("clamps rather than escaping the container", () => {
    expect(splitFromPointer(-100, 0, 1000)).toBe(10);
    expect(splitFromPointer(5000, 0, 1000)).toBe(90);
  });

  it("returns the default for a zero-size container", () => {
    expect(splitFromPointer(10, 0, 0)).toBe(DEFAULT_SPLIT.col);
  });
});

describe("nudgeSplit", () => {
  it("applies and clamps a delta", () => {
    expect(nudgeSplit(50, 1)).toBe(51);
    expect(nudgeSplit(50, -5)).toBe(45);
    expect(nudgeSplit(88, 5)).toBe(90);
    expect(nudgeSplit(12, -5)).toBe(10);
  });
});

describe("gridTemplate", () => {
  it("emits a three-track template with a fixed divider", () => {
    expect(gridTemplate(40)).toBe("40% 6px 1fr");
  });
});

describe("parseStoredSplit", () => {
  it("round-trips a serialized split", () => {
    const split = { col: 30, row: 70 };
    expect(parseStoredSplit(serializeSplit(split))).toEqual(split);
  });

  it("falls back to the default for missing or corrupt storage", () => {
    expect(parseStoredSplit(null)).toEqual(DEFAULT_SPLIT);
    expect(parseStoredSplit("nonsense")).toEqual(DEFAULT_SPLIT);
    expect(parseStoredSplit("[]")).toEqual(DEFAULT_SPLIT);
    expect(parseStoredSplit('{"col":"x","row":50}')).toEqual(DEFAULT_SPLIT);
  });

  it("clamps stored values that are out of range", () => {
    expect(parseStoredSplit('{"col":-40,"row":400}')).toEqual({ col: 10, row: 90 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run lib/split-layout.test.ts
```

Expected: FAIL — cannot resolve `./split-layout`.

- [ ] **Step 3: Write `lib/split-layout.ts`**

```ts
import { isJsonObject, parseJson } from "@/shared/json";

export const MIN_SPLIT_PERCENT = 10;
export const MAX_SPLIT_PERCENT = 90;
export const DIVIDER_SIZE_PX = 6;
export const SPLIT_STORAGE_KEY = "terminal-site.split";

export interface SplitState {
  col: number;
  row: number;
}

export const DEFAULT_SPLIT: SplitState = { col: 50, row: 50 };

export function clampSplit(percent: number): number {
  if (Number.isNaN(percent)) return DEFAULT_SPLIT.col;
  if (percent < MIN_SPLIT_PERCENT) return MIN_SPLIT_PERCENT;
  if (percent > MAX_SPLIT_PERCENT) return MAX_SPLIT_PERCENT;
  return percent;
}

export function splitFromPointer(
  pointer: number,
  containerStart: number,
  containerSize: number,
): number {
  if (containerSize <= 0) return DEFAULT_SPLIT.col;
  return clampSplit(((pointer - containerStart) / containerSize) * 100);
}

export function nudgeSplit(percent: number, delta: number): number {
  return clampSplit(percent + delta);
}

export function gridTemplate(percent: number): string {
  return `${percent}% ${DIVIDER_SIZE_PX}px 1fr`;
}

export function serializeSplit(split: SplitState): string {
  return JSON.stringify(split);
}

export function parseStoredSplit(raw: string | null): SplitState {
  if (raw === null) return DEFAULT_SPLIT;

  const parsed = parseJson(raw);
  if (parsed === null || !isJsonObject(parsed)) return DEFAULT_SPLIT;
  if (typeof parsed.col !== "number" || typeof parsed.row !== "number") {
    return DEFAULT_SPLIT;
  }

  return { col: clampSplit(parsed.col), row: clampSplit(parsed.row) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run lib/split-layout.test.ts && npm run lint && npm run type-check
```

Expected: PASS.

- [ ] **Step 5: Commit** *(ask for approval first)*

```bash
git add lib/split-layout.ts lib/split-layout.test.ts
git commit -m "Add split layout arithmetic and persistence helpers"
```

---

### Task 8: SplitDivider component

**Files:**
- Create: `components/split-divider.tsx`, `components/split-divider.module.css`, `components/split-divider.test.tsx`

**Interfaces:**
- Consumes: `splitFromPointer`, `nudgeSplit` (Task 7).
- Produces:
  - `interface SplitDividerProps { orientation: "vertical" | "horizontal"; percent: number; label: string; containerRef: RefObject<HTMLElement | null>; onChange: (percent: number) => void }`
  - `function SplitDivider(props: SplitDividerProps): JSX.Element`

`orientation: "vertical"` means the divider *bar* is vertical — it separates left from right and is dragged horizontally.

- [ ] **Step 1: Write the failing test**

`components/split-divider.test.tsx`:

```tsx
import type { RefObject } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitDivider } from "./split-divider";

function renderDivider(orientation: "vertical" | "horizontal", percent = 50) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect;
  // A plain object satisfies RefObject structurally. `createRef()` returns a
  // sealed object, so reassigning `current` on it is needlessly fragile.
  const containerRef: RefObject<HTMLElement | null> = { current: container };

  render(
    <SplitDivider
      orientation={orientation}
      percent={percent}
      label="Column split"
      containerRef={containerRef}
      onChange={onChange}
    />,
  );

  return { onChange, separator: screen.getByRole("separator") };
}

describe("SplitDivider", () => {
  it("exposes accessible separator semantics", () => {
    const { separator } = renderDivider("vertical", 40);
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "40");
    expect(separator).toHaveAttribute("aria-valuemin", "10");
    expect(separator).toHaveAttribute("aria-valuemax", "90");
    expect(separator).toHaveAttribute("aria-label", "Column split");
    expect(separator).toHaveAttribute("tabindex", "0");
  });

  it("moves by 1 percent on arrow keys", () => {
    const { onChange, separator } = renderDivider("vertical", 50);
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(51);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(49);
  });

  it("moves by 5 percent with shift held", () => {
    const { onChange, separator } = renderDivider("vertical", 50);
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("uses the up and down keys for a horizontal divider", () => {
    const { onChange, separator } = renderDivider("horizontal", 50);
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(51);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("jumps to the limits on Home and End", () => {
    const { onChange, separator } = renderDivider("vertical", 50);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith(10);
    fireEvent.keyDown(separator, { key: "End" });
    expect(onChange).toHaveBeenCalledWith(90);
  });

  it("converts a pointer drag into a percentage", () => {
    // PointerEvent and pointer capture are polyfilled in test/setup.ts.
    const { onChange, separator } = renderDivider("vertical", 50);

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 300, clientY: 250 });
    expect(onChange).toHaveBeenLastCalledWith(30);

    fireEvent.pointerUp(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 800, clientY: 250 });
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  it("stops dragging when the pointer is cancelled", () => {
    const { onChange, separator } = renderDivider("vertical", 50);

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500, clientY: 250 });
    fireEvent.pointerCancel(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 800, clientY: 250 });

    expect(onChange).toHaveBeenLastCalledWith(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run components/split-divider.test.tsx
```

Expected: FAIL — cannot resolve `./split-divider`.

- [ ] **Step 3: Write `components/split-divider.module.css`**

```css
.divider {
  background: var(--divider);
  border: 0;
  padding: 0;
  touch-action: none;
}

.divider:hover,
.divider:focus-visible {
  background: var(--divider-active);
  outline: none;
}

.vertical {
  cursor: col-resize;
  grid-column: 2;
  grid-row: 1 / 4;
  z-index: 2;
}

.horizontal {
  cursor: row-resize;
  grid-column: 1 / 4;
  grid-row: 2;
  z-index: 1;
}
```

The vertical divider spans all three rows and the horizontal one spans all three columns; they overlap in the centre 6×6 px, where the higher `z-index` wins. That overlap is what produces the cross.

- [ ] **Step 4: Write `components/split-divider.tsx`**

```tsx
"use client";

import {
  useCallback,
  useRef,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
  nudgeSplit,
  splitFromPointer,
} from "@/lib/split-layout";
import styles from "./split-divider.module.css";

export interface SplitDividerProps {
  orientation: "vertical" | "horizontal";
  percent: number;
  label: string;
  containerRef: RefObject<HTMLElement | null>;
  onChange: (percent: number) => void;
}

const DECREASE_KEYS: Record<"vertical" | "horizontal", string> = {
  vertical: "ArrowLeft",
  horizontal: "ArrowUp",
};

const INCREASE_KEYS: Record<"vertical" | "horizontal", string> = {
  vertical: "ArrowRight",
  horizontal: "ArrowDown",
};

export function SplitDivider({
  orientation,
  percent,
  label,
  containerRef,
  onChange,
}: SplitDividerProps): JSX.Element {
  const dragging = useRef(false);

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      const next =
        orientation === "vertical"
          ? splitFromPointer(clientX, rect.left, rect.width)
          : splitFromPointer(clientY, rect.top, rect.height);
      onChange(next);
    },
    [containerRef, onChange, orientation],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPointer(event.clientX, event.clientY);
    },
    [applyPointer],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      applyPointer(event.clientX, event.clientY);
    },
    [applyPointer],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handlePointerCancel = useCallback(() => {
    // No releasePointerCapture() here: per the Pointer Events spec, capture
    // is implicitly released by the browser before pointercancel fires, so
    // calling it again can throw NotFoundError. Clearing the ref is the fix.
    dragging.current = false;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 5 : 1;

      if (event.key === DECREASE_KEYS[orientation]) {
        event.preventDefault();
        onChange(nudgeSplit(percent, -step));
        return;
      }
      if (event.key === INCREASE_KEYS[orientation]) {
        event.preventDefault();
        onChange(nudgeSplit(percent, step));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        onChange(MIN_SPLIT_PERCENT);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        onChange(MAX_SPLIT_PERCENT);
      }
    },
    [onChange, orientation, percent],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={MIN_SPLIT_PERCENT}
      aria-valuemax={MAX_SPLIT_PERCENT}
      className={`${styles.divider} ${styles[orientation]}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    />
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run components/split-divider.test.tsx && npm run lint && npm run type-check
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add components/split-divider.tsx components/split-divider.module.css components/split-divider.test.tsx
git commit -m "Add keyboard-accessible split divider component"
```

---

### Task 9: usePtySocket hook

**Files:**
- Create: `lib/use-pty-socket.ts`, `lib/use-pty-socket.test.ts`, `test/mock-websocket.ts`

**Interfaces:**
- Consumes: `serializeMessage`, `parseServerMessage` (Task 2).
- Produces:
  - `type PaneStatus = "connecting" | "ready" | "ended" | "error"`
  - `interface UsePtySocketOptions { pane: number; token: string; write: (data: Uint8Array) => void }`
  - `interface UsePtySocket { status: PaneStatus; errorMessage: string | null; connect: (cols: number, rows: number) => void; sendInput: (data: string) => void; sendResize: (cols: number, rows: number) => void; restart: () => void }`
  - `usePtySocket(options: UsePtySocketOptions): UsePtySocket`
  - `const RESIZE_THROTTLE_MS = 50`

- [ ] **Step 1: Write the mock WebSocket helper**

`test/mock-websocket.ts`:

```ts
import { vi } from "vitest";

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  binaryType = "blob";
  readyState: number = MockWebSocket.CONNECTING;
  sent: (string | ArrayBufferLike | ArrayBufferView)[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: complete the connection. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: deliver a server frame. */
  receive(data: string | ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static last(): MockWebSocket {
    const socket = MockWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error("no MockWebSocket was constructed");
    return socket;
  }

  static install(): void {
    vi.stubGlobal("WebSocket", MockWebSocket);
  }

  static textFrames(socket: MockWebSocket): string[] {
    return socket.sent.filter((frame): frame is string => typeof frame === "string");
  }
}
```

- [ ] **Step 2: Write the failing hook test**

`lib/use-pty-socket.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import { MockWebSocket } from "@/test/mock-websocket";
import { usePtySocket } from "./use-pty-socket";

beforeEach(() => {
  MockWebSocket.reset();
  MockWebSocket.install();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup(write = vi.fn()) {
  const result = renderHook(() => usePtySocket({ pane: 2, token: "tok", write }));
  return { ...result, write };
}

describe("usePtySocket", () => {
  it("starts in the connecting state and opens no socket until connect", () => {
    const { result } = setup();
    expect(result.current.status).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("sends a well-formed hello on open", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.textFrames(MockWebSocket.last())).toEqual([
      serializeMessage({ type: "hello", token: "tok", pane: 2, cols: 80, rows: 24 }),
    ]);
  });

  it("becomes ready on the ready frame", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    expect(result.current.status).toBe("ready");
  });

  it("surfaces a server error message", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(
        serializeMessage({ type: "error", message: "tmux not found on PATH" }),
      ),
    );
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("tmux not found on PATH");
  });

  it("writes binary frames into the terminal", () => {
    const write = vi.fn();
    const { result } = setup(write);
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(new TextEncoder().encode("hi").buffer));

    expect(write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(write.mock.calls[0]?.[0])).toBe("hi");
  });

  it("sends input as binary", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => result.current.sendInput("ls\n"));

    const binary = MockWebSocket.last().sent.filter(
      (frame): frame is Uint8Array => frame instanceof Uint8Array,
    );
    expect(new TextDecoder().decode(binary[0])).toBe("ls\n");
  });

  it("throttles resize to one trailing frame", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());

    act(() => {
      result.current.sendResize(81, 24);
      result.current.sendResize(82, 24);
      result.current.sendResize(83, 25);
    });
    expect(MockWebSocket.textFrames(MockWebSocket.last())).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(60));
    const frames = MockWebSocket.textFrames(MockWebSocket.last());
    expect(frames.at(-1)).toBe(serializeMessage({ type: "resize", cols: 83, rows: 25 }));
    expect(frames).toHaveLength(2);
  });

  it("goes to ended when the socket closes", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().close());
    expect(result.current.status).toBe("ended");
  });

  it("reconnects with the last known size on restart", () => {
    const { result } = setup();
    act(() => result.current.connect(90, 30));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().close());
    act(() => result.current.restart());
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.textFrames(MockWebSocket.last())).toEqual([
      serializeMessage({ type: "hello", token: "tok", pane: 2, cols: 90, rows: 30 }),
    ]);
  });

  it("closes the socket on unmount", () => {
    const { result, unmount } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    const socket = MockWebSocket.last();
    unmount();
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run lib/use-pty-socket.test.ts
```

Expected: FAIL — cannot resolve `./use-pty-socket`.

- [ ] **Step 4: Write `lib/use-pty-socket.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseServerMessage, serializeMessage } from "@/shared/protocol";

export const RESIZE_THROTTLE_MS = 50;

export type PaneStatus = "connecting" | "ready" | "ended" | "error";

export interface UsePtySocketOptions {
  pane: number;
  token: string;
  write: (data: Uint8Array) => void;
}

export interface UsePtySocket {
  status: PaneStatus;
  errorMessage: string | null;
  connect: (cols: number, rows: number) => void;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  restart: () => void;
}

function socketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/terminal`;
}

export function usePtySocket({ pane, token, write }: UsePtySocketOptions): UsePtySocket {
  const [status, setStatus] = useState<PaneStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef({ cols: 80, rows: 24 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const erroredRef = useRef(false);

  // `write` changes identity every render; keep it in a ref so the socket
  // handlers do not need to be rebuilt.
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  const connect = useCallback(
    (cols: number, rows: number) => {
      socketRef.current?.close();
      sizeRef.current = { cols, rows };
      erroredRef.current = false;
      setErrorMessage(null);
      setStatus("connecting");

      const ws = new WebSocket(socketUrl());
      ws.binaryType = "arraybuffer";
      socketRef.current = ws;

      ws.onopen = () => {
        ws.send(serializeMessage({ type: "hello", token, pane, cols, rows }));
      };

      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === "string") {
          const msg = parseServerMessage(event.data);
          if (msg === null) return;
          if (msg.type === "ready") {
            setStatus("ready");
            return;
          }
          erroredRef.current = true;
          setErrorMessage(msg.message);
          setStatus("error");
          return;
        }
        writeRef.current(new Uint8Array(event.data));
      };

      ws.onclose = () => {
        if (socketRef.current === ws) socketRef.current = null;
        if (!erroredRef.current) setStatus("ended");
      };
    },
    [pane, token],
  );

  const restart = useCallback(() => {
    const { cols, rows } = sizeRef.current;
    connect(cols, rows);
  }, [connect]);

  const sendInput = useCallback((data: string) => {
    const ws = socketRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(new TextEncoder().encode(data));
  }, []);

  // Dragging a divider fires ResizeObserver at frame rate, and tmux redraws
  // the whole screen on every resize. Send only a trailing frame.
  const sendResize = useCallback((cols: number, rows: number) => {
    sizeRef.current = { cols, rows };
    if (resizeTimerRef.current !== null) return;

    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      const ws = socketRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      const size = sizeRef.current;
      ws.send(serializeMessage({ type: "resize", cols: size.cols, rows: size.rows }));
    }, RESIZE_THROTTLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  return { status, errorMessage, connect, sendInput, sendResize, restart };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run lib/use-pty-socket.test.ts && npm run lint && npm run type-check
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add lib/use-pty-socket.ts lib/use-pty-socket.test.ts test/mock-websocket.ts
git commit -m "Add usePtySocket hook with throttled resize and restart"
```

---

### Task 10: TerminalPane component

**Files:**
- Create: `components/terminal-pane.tsx`, `components/terminal-pane.module.css`, `components/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `usePtySocket` (Task 9).
- Produces:
  - `interface TerminalPaneProps { pane: number; token: string; className?: string }`
  - `function TerminalPane(props: TerminalPaneProps): JSX.Element`

- [ ] **Step 1: Write the failing test**

`@wterm/react` and `@wterm/ghostty` are mocked — the real ones need WASM, which jsdom cannot instantiate meaningfully.

`components/terminal-pane.test.tsx`:

```tsx
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import { MockWebSocket } from "@/test/mock-websocket";

// `vi.mock` factories are hoisted above module scope, so a plain `const` declared
// here would not yet exist when the factory closes over it. `vi.hoisted` is the
// supported way to share a spy with a mock factory.
const { writeSpy } = vi.hoisted(() => ({ writeSpy: vi.fn() }));

vi.mock("@wterm/ghostty", () => ({
  GhosttyCore: { load: vi.fn(async () => ({ kind: "fake-core" })) },
}));

vi.mock("@wterm/react/css", () => ({}));

vi.mock("@wterm/react", () => ({
  useTerminal: () => ({ ref: { current: null }, write: writeSpy }),
  Terminal: ({
    onReady,
    onData,
  }: {
    onReady?: (wt: { cols: number; rows: number }) => void;
    onData?: (data: string) => void;
  }) => {
    useEffect(() => {
      onReady?.({ cols: 100, rows: 40 });
    }, [onReady]);
    return (
      <button type="button" data-testid="fake-terminal" onClick={() => onData?.("x")}>
        terminal
      </button>
    );
  },
}));

const { TerminalPane } = await import("./terminal-pane");

beforeEach(() => {
  MockWebSocket.reset();
  MockWebSocket.install();
  writeSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPane() {
  render(<TerminalPane pane={1} token="tok" />);
  expect(await screen.findByTestId("fake-terminal")).toBeInTheDocument();
}

describe("TerminalPane", () => {
  it("loads a core, then connects and sends hello with the terminal's size", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.textFrames(MockWebSocket.last())).toEqual([
      serializeMessage({ type: "hello", token: "tok", pane: 1, cols: 100, rows: 40 }),
    ]);
  });

  it("shows a session-ended overlay with a restart control", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    act(() => MockWebSocket.last().close());

    expect(await screen.findByText(/session ended/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("renders a server error message", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(
        serializeMessage({ type: "error", message: "tmux not found on PATH" }),
      ),
    );

    expect(await screen.findByText(/tmux not found on PATH/i)).toBeInTheDocument();
  });

  it("labels the pane for assistive technology", async () => {
    await renderPane();
    expect(screen.getByRole("group", { name: /terminal 2/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run components/terminal-pane.test.tsx
```

Expected: FAIL — cannot resolve `./terminal-pane`.

- [ ] **Step 3: Write `components/terminal-pane.module.css`**

```css
.pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal {
  width: 100%;
  height: 100%;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  background: rgb(10 10 10 / 85%);
  font-size: 0.8125rem;
  text-align: center;
}

.message {
  color: #9a9a9a;
  margin: 0;
  padding: 0 1rem;
}

.error {
  color: #ff6b6b;
}

.restart {
  background: transparent;
  border: 1px solid var(--divider-active);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0.35rem 0.9rem;
}

.restart:hover {
  background: rgb(255 255 255 / 8%);
}
```

- [ ] **Step 4: Write `components/terminal-pane.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import type { TerminalCore } from "@wterm/core";
import type { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import { usePtySocket } from "@/lib/use-pty-socket";
import "@wterm/react/css";
import styles from "./terminal-pane.module.css";

const WASM_PATH = "/ghostty-vt.wasm";

export interface TerminalPaneProps {
  pane: number;
  token: string;
  className?: string;
}

export function TerminalPane({ pane, token, className }: TerminalPaneProps): JSX.Element {
  // GhosttyCore is stateful — it owns the terminal buffer, dimensions, and
  // scrollback — so every pane needs its own instance. The .wasm itself is
  // fetched once and reused from HTTP cache.
  const [core, setCore] = useState<TerminalCore | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);

  const { ref, write } = useTerminal();

  const writeBytes = useCallback((data: Uint8Array) => write(data), [write]);

  const socket = usePtySocket({ pane, token, write: writeBytes });

  useEffect(() => {
    let cancelled = false;
    GhosttyCore.load({ wasmPath: WASM_PATH })
      .then((loaded) => {
        if (!cancelled) setCore(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCoreError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { connect, sendInput, sendResize, restart, status, errorMessage } = socket;

  const handleReady = useCallback(
    (wt: WTerm) => {
      connect(wt.cols, wt.rows);
    },
    [connect],
  );

  const label = `Terminal ${pane + 1}`;
  const paneClassName = className === undefined ? styles.pane : `${styles.pane} ${className}`;

  return (
    <section role="group" aria-label={label} className={paneClassName}>
      {core !== null && (
        <Terminal
          ref={ref}
          core={core}
          cols={80}
          rows={24}
          autoResize
          onReady={handleReady}
          onData={sendInput}
          onResize={sendResize}
          className={styles.terminal}
          style={{ borderRadius: 0, boxShadow: "none", padding: 0 }}
        />
      )}

      {coreError !== null && (
        <div className={styles.overlay}>
          <p className={`${styles.message} ${styles.error}`}>
            Failed to load terminal core: {coreError}
          </p>
        </div>
      )}

      {coreError === null && core === null && (
        <div className={styles.overlay}>
          <p className={styles.message}>Loading terminal core…</p>
        </div>
      )}

      {status === "error" && (
        <div className={styles.overlay}>
          <p className={`${styles.message} ${styles.error}`}>{errorMessage}</p>
          <button type="button" className={styles.restart} onClick={restart}>
            Restart
          </button>
        </div>
      )}

      {status === "ended" && (
        <div className={styles.overlay}>
          <p className={styles.message}>Session ended</p>
          <button type="button" className={styles.restart} onClick={restart}>
            Restart
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run components/terminal-pane.test.tsx && npm run lint && npm run type-check
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add components/terminal-pane.tsx components/terminal-pane.module.css components/terminal-pane.test.tsx
git commit -m "Add TerminalPane with per-pane ghostty core and status overlays"
```

---

### Task 11: TerminalGrid component

**Files:**
- Create: `components/terminal-grid.tsx`, `components/terminal-grid.module.css`, `components/terminal-grid.test.tsx`

**Interfaces:**
- Consumes: `TerminalPane` (Task 10); `SplitDivider` (Task 8); `gridTemplate`, `parseStoredSplit`, `serializeSplit`, `DEFAULT_SPLIT`, `SPLIT_STORAGE_KEY` (Task 7); `PANE_COUNT` (Task 2).
- Produces:
  - `interface TerminalGridProps { token: string }`
  - `function TerminalGrid(props: TerminalGridProps): JSX.Element`

- [ ] **Step 1: Write the failing test**

`components/terminal-grid.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPLIT_STORAGE_KEY, serializeSplit } from "@/lib/split-layout";

vi.mock("./terminal-pane", () => ({
  TerminalPane: ({ pane }: { pane: number }) => (
    <div data-testid={`pane-${pane}`}>pane {pane}</div>
  ),
}));

const { TerminalGrid } = await import("./terminal-grid");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TerminalGrid", () => {
  it("renders four panes and two dividers", () => {
    render(<TerminalGrid token="tok" />);
    for (let pane = 0; pane < 4; pane += 1) {
      expect(screen.getByTestId(`pane-${pane}`)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("defaults to a 50/50 cross", () => {
    render(<TerminalGrid token="tok" />);
    const [column, row] = screen.getAllByRole("separator");
    expect(column).toHaveAttribute("aria-valuenow", "50");
    expect(row).toHaveAttribute("aria-valuenow", "50");
  });

  it("moves the column split with the keyboard and persists it", () => {
    render(<TerminalGrid token="tok" />);
    const [column] = screen.getAllByRole("separator");
    if (column === undefined) throw new Error("missing separator");

    fireEvent.keyDown(column, { key: "ArrowRight", shiftKey: true });

    expect(column).toHaveAttribute("aria-valuenow", "55");
    expect(window.localStorage.getItem(SPLIT_STORAGE_KEY)).toBe(
      serializeSplit({ col: 55, row: 50 }),
    );
  });

  it("restores a stored layout after mount", () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, serializeSplit({ col: 25, row: 75 }));
    render(<TerminalGrid token="tok" />);
    const [column, row] = screen.getAllByRole("separator");
    expect(column).toHaveAttribute("aria-valuenow", "25");
    expect(row).toHaveAttribute("aria-valuenow", "75");
  });

  it("ignores corrupt stored layout", () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, "{{{");
    render(<TerminalGrid token="tok" />);
    const [column] = screen.getAllByRole("separator");
    expect(column).toHaveAttribute("aria-valuenow", "50");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run components/terminal-grid.test.tsx
```

Expected: FAIL — cannot resolve `./terminal-grid`.

- [ ] **Step 3: Write `components/terminal-grid.module.css`**

```css
.grid {
  display: grid;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
}

.cell00 {
  grid-column: 1;
  grid-row: 1;
}

.cell01 {
  grid-column: 3;
  grid-row: 1;
}

.cell10 {
  grid-column: 1;
  grid-row: 3;
}

.cell11 {
  grid-column: 3;
  grid-row: 3;
}
```

- [ ] **Step 4: Write `components/terminal-grid.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  DEFAULT_SPLIT,
  SPLIT_STORAGE_KEY,
  gridTemplate,
  parseStoredSplit,
  serializeSplit,
  type SplitState,
} from "@/lib/split-layout";
import { SplitDivider } from "./split-divider";
import { TerminalPane } from "./terminal-pane";
import styles from "./terminal-grid.module.css";

export interface TerminalGridProps {
  token: string;
}

const CELL_CLASSES = [styles.cell00, styles.cell01, styles.cell10, styles.cell11];

export function TerminalGrid({ token }: TerminalGridProps): JSX.Element {
  // Start from the default rather than reading localStorage during render:
  // the server renders this markup too, and a mismatch would break hydration.
  const [split, setSplit] = useState<SplitState>(DEFAULT_SPLIT);
  const [restored, setRestored] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSplit(parseStoredSplit(window.localStorage.getItem(SPLIT_STORAGE_KEY)));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    window.localStorage.setItem(SPLIT_STORAGE_KEY, serializeSplit(split));
  }, [restored, split]);

  const setCol = useCallback((col: number) => {
    setSplit((prev) => ({ ...prev, col }));
  }, []);

  const setRow = useCallback((row: number) => {
    setSplit((prev) => ({ ...prev, row }));
  }, []);

  return (
    <main
      ref={containerRef}
      className={styles.grid}
      style={{
        gridTemplateColumns: gridTemplate(split.col),
        gridTemplateRows: gridTemplate(split.row),
      }}
    >
      {CELL_CLASSES.map((cellClass, pane) => (
        <TerminalPane key={pane} pane={pane} token={token} className={cellClass} />
      ))}

      <SplitDivider
        orientation="vertical"
        percent={split.col}
        label="Resize columns"
        containerRef={containerRef}
        onChange={setCol}
      />
      <SplitDivider
        orientation="horizontal"
        percent={split.row}
        label="Resize rows"
        containerRef={containerRef}
        onChange={setRow}
      />
    </main>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run components/terminal-grid.test.tsx && npm run lint && npm run type-check
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add components/terminal-grid.tsx components/terminal-grid.module.css components/terminal-grid.test.tsx
git commit -m "Add TerminalGrid with persisted cross-divider layout"
```

---

### Task 12: Wire the page and run the real thing

**Files:**
- Modify: `app/page.tsx` (replace the Task 1 placeholder)

**Interfaces:**
- Consumes: `bootToken` (Task 4); `TerminalGrid` (Task 11).
- Produces: a working app at `http://127.0.0.1:3000`.

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
import type { JSX } from "react";
import { TerminalGrid } from "@/components/terminal-grid";
import { bootToken } from "@/server/token";

// This page embeds the per-process boot token. Prerendering it would bake in
// the token from build time and every WebSocket would fail auth under
// `next start`.
export const dynamic = "force-dynamic";

export default function Page(): JSX.Element {
  return <TerminalGrid token={bootToken()} />;
}
```

- [ ] **Step 2: Run the app and verify all four shells attach**

```bash
npm run dev
```

Open `http://127.0.0.1:3000` and confirm:
- Four panes, each with a shell prompt.
- `echo hello` in the top-left pane prints in that pane only.
- Dragging the vertical divider resizes left and right; the horizontal one resizes top and bottom.
- Reloading the page brings back the same shell content.

- [ ] **Step 3: Verify the tmux sessions exist**

```bash
tmux ls | grep termsite-
```

Expected: `termsite-0` through `termsite-3`.

- [ ] **Step 4: Verify persistence across a server restart**

Type `echo PERSIST_CHECK` in a pane, stop the dev server with Ctrl-C, run `npm run dev` again, and reload. Expected: `PERSIST_CHECK` is still on screen.

- [ ] **Step 5: Run the gate**

```bash
npm run lint && npm run type-check && npm test && npm run build
```

Expected: all four pass.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add app/page.tsx
git commit -m "Wire the terminal grid into the page with the boot token"
```

---

### Task 13: Playwright end-to-end suite and README

The unit tests all mock either the WASM core or the PTY. This task is the only place the real stack runs end to end.

**Files:**
- Create: `playwright.config.ts`, `e2e/terminals.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the running app (Task 12).
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

`workers: 1` and `fullyParallel: false` are deliberate — the four tmux sessions are
shared global state, so parallel specs would fight over them.

- [ ] **Step 2: Write `e2e/terminals.spec.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);

async function hasTmux(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

async function killSessions(): Promise<void> {
  for (let pane = 0; pane < 4; pane += 1) {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", `termsite-${pane}`]);
    } catch {
      // Session may not exist; nothing to clean up.
    }
  }
}

function pane(page: Page, index: number) {
  return page.getByRole("group", { name: `Terminal ${index + 1}` });
}

async function typeInPane(page: Page, index: number, text: string): Promise<void> {
  await pane(page, index).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test.beforeAll(async () => {
  test.skip(!(await hasTmux()), "tmux is not installed on PATH");
  await killSessions();
});

test.afterAll(async () => {
  await killSessions();
});

test("four panes attach to four independent shells", async ({ page }) => {
  await page.goto("/");

  for (let index = 0; index < 4; index += 1) {
    await expect(pane(page, index)).toBeVisible();
  }

  await typeInPane(page, 1, "echo ISOLATION_MARKER");

  await expect(pane(page, 1)).toContainText("ISOLATION_MARKER");
  await expect(pane(page, 0)).not.toContainText("ISOLATION_MARKER");
  await expect(pane(page, 2)).not.toContainText("ISOLATION_MARKER");
  await expect(pane(page, 3)).not.toContainText("ISOLATION_MARKER");
});

test("dragging the column divider reflows the panes", async ({ page }) => {
  await page.goto("/");

  const left = pane(page, 0);
  await expect(left).toBeVisible();
  const before = await left.boundingBox();

  const divider = page.getByRole("separator", { name: "Resize columns" });
  const box = await divider.boundingBox();
  if (box === null) throw new Error("divider has no bounding box");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await left.boundingBox();
  if (before === null || after === null) throw new Error("pane has no bounding box");
  expect(after.width).toBeLessThan(before.width - 100);
});

test("the divider is keyboard operable", async ({ page }) => {
  await page.goto("/");

  const divider = page.getByRole("separator", { name: "Resize rows" });
  await divider.focus();
  await divider.press("Shift+ArrowUp");

  await expect(divider).toHaveAttribute("aria-valuenow", "45");
});

test("shells survive a page reload", async ({ page }) => {
  await page.goto("/");

  await typeInPane(page, 2, "echo PERSIST_MARKER");
  await expect(pane(page, 2)).toContainText("PERSIST_MARKER");

  await page.reload();

  await expect(pane(page, 2)).toContainText("PERSIST_MARKER");
});
```

- [ ] **Step 3: Install browsers and run the suite**

```bash
npx playwright install chromium
npm run test:e2e
```

Expected: 4 passing tests. If the reload test fails, check `tmux ls` — the session
should still exist, which localises the fault to the client reattach path rather
than to tmux.

- [ ] **Step 4: Rewrite `README.md`**

````markdown
# terminal-site

Four resizable terminals in the browser, in a 2×2 grid. Each pane is a live shell
on this machine, rendered with [wterm](https://github.com/vercel-labs/wterm) using
the [libghostty](https://ghostty.org) VT core and backed by its own tmux session.

## Security

**This serves a shell with your full environment. Run it on localhost only.**

The server binds `127.0.0.1` and will not accept a WebSocket upgrade unless the
`Origin` header matches the loopback address it is serving, and the connection
presents a token generated fresh each time the server starts. Do not put this
behind a tunnel or a reverse proxy.

## Requirements

- Node.js 22+
- tmux on `PATH`

## Usage

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000.

Each pane attaches to a tmux session named `termsite-0` … `termsite-3`, created on
first use. Because the state lives in tmux, the shells survive page reloads, server
restarts, and closing the browser. Attaching detaches any other client on that
session, so the browser pane always controls sizing.

Drag the cross-shaped divider to resize. The dividers are keyboard operable: tab to
one, then use the arrow keys (hold shift for larger steps, `Home`/`End` for the
limits). The layout persists in `localStorage`.

To wipe a session and start fresh:

```bash
tmux kill-session -t termsite-0
```

## Development

```bash
npm run lint
npm run type-check
npm test          # Vitest
npm run test:e2e  # Playwright, requires tmux
npm run build
```

`public/ghostty-vt.wasm` is vendored from `@wterm/ghostty` and committed. A unit
test byte-compares it against the installed package, so bumping the dependency
without re-copying the binary fails the test run.
````

- [ ] **Step 5: Run the full gate**

```bash
npm run lint && npm run type-check && npm test && npm run build && npm run test:e2e
```

Expected: all five pass.

- [ ] **Step 6: Commit** *(ask for approval first)*

```bash
git add playwright.config.ts e2e/ README.md
git commit -m "Add Playwright end-to-end suite and document setup"
```

---

## Self-Review Notes

**Spec coverage.** Every spec section maps to a task: threat model → Tasks 4 and 6;
transport and control messages → Task 2; spawning, `-A -D`, `TMUX` stripping, missing
tmux → Tasks 3, 5, 6; lifecycle table → Task 5 tests; module table → Tasks 2–11;
force-dynamic → Task 12; resize throttling → Task 9; one core per pane → Task 10;
layout and ARIA → Tasks 7, 8, 11; wasm parity guard → Task 1; all five test
categories → Tasks 1–13.

**Known deviations from the spec, both deliberate:**
- The spec's `MAX_COLS`/`MAX_ROWS` are realised as a single `MAX_DIMENSION` of 10,000
  in `shared/protocol.ts`; the spec did not fix a value.
- The spec lists `isTmuxAvailable`; the plan uses `findTmux(pathEnv)` instead, which
  returns the resolved path. That path is needed for spawning and makes the function
  unit-testable against a temp directory rather than the real `PATH`.
