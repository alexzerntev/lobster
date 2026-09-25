# Lobster UI development

The workflow viewer and development server live entirely in this repository.
No OpenClaw checkout, installation, Gateway, or credentials are needed. The
server is development-only and read-only: it inspects definitions and renders
graphs with the local engine, without executing workflows or requesting inference.

## Start in Docker

From the Lobster checkout:

```sh
./dev/web/dev up
```

Open <http://127.0.0.1:5180>. Docker Compose Watch copies source edits into the
isolated container; Vite updates the UI and `tsx watch` restarts server changes.
Use `?theme=light` or `?theme=dark` to preview either theme; otherwise the viewer
follows the system preference. Use `?host=offline` to inspect the disconnected
state. The page contains the viewer without additional navigation chrome.

```sh
./dev/web/dev status
./dev/web/dev logs
./dev/web/dev test
./dev/web/dev shell
./dev/web/dev stop
./dev/web/dev rebuild
```

Rebuild after changing dependencies or Docker configuration. Stop another server
using port 5180 first.

## Ownership

- `ui/src/`: the workflow list, React Flow renderer, source explorer, input form
  previews, and view lifecycle. `@lobster/ui` exports the two mount functions and
  their small host interface; it has no OpenClaw SDK dependency or registration.
- `ui/workflow-types.ts`: the shared read-only viewer data contract. Graph types
  derive from Lobster's engine; the browser does not import engine runtime code.
- `ui/theme/`: local light/dark tokens, controls, fonts, and artwork. These preserve
  the existing appearance; licenses and provenance are in its `NOTICE.md`.
- `src/`: the Lobster engine. JSON graph output uses the same native graph as the
  Mermaid, DOT, and ASCII formats. The viewer expands branches and loop bodies
  for display without changing the engine's graph or execution behavior.
- `dev/web/server.ts` and `dev-api.ts`: development HTTP adapter and bounded local
  file reads. The API's built-in workflow source paths are explicitly registered.
- `dev/web/preview-host.ts`, `dialog.ts`, and `main.ts`: local transport, navigation,
  modal presentation, connection state, and mount lifecycle.
- `dev/web/workspace/workflows/`: synthetic workflow fixtures. File edits,
  additions, renames, and deletions refresh the list, graph, and source tree.

The Code view includes a read-only tree of workflow definitions and companion
scripts under `workflows/`. Files are read when selected; they are never imported
or executed. YAML, JSON, JavaScript, TypeScript, shell, Python, Markdown, and text
files are supported. The tree does not infer dependencies from shell commands or
reveal files outside this directory. Built-ins expose their registered source
only. Hidden paths, `node_modules`, symlinks, and hardlinks are excluded. Reads
are bounded to 256 KiB per file; trees stop at 100 files, 1,000 entries, or eight
nested directories and indicate truncation. Invalid YAML stays available to inspect.

## Development boundary

The preview host supports only workflow list/get, source tree/file reads, local
page navigation, connection notifications, workflow invalidation, and dialogs.
Unknown methods, events, page IDs, and parameters fail explicitly. There are no
session, chat, authentication, approval, or execution endpoints. It does not
contact OpenClaw. A future host integration can implement the viewer interface
without owning a second copy of the renderer.

One watcher publishes changes through a single event stream per browser shell.
Streams, subscriptions, requests, timers, and mounted views are disposed when
replaced or shut down. Hidden views defer reloads until presented again; stale
requests cannot replace the selected workflow or file.

## Maintenance and packaging

`ui` and `dev/web` are private workspaces. The runtime package's file allowlist and
production TypeScript build exclude both. The server rejects
`NODE_ENV=production`; there is no server CLI registration or runtime import of
the viewer. This work does not introduce a live execution dashboard or retained
run history, which remain separate product decisions in [the vision](../../VISION.md).

All checks run from this repository alone:

```sh
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test:web` runs the read-only API/host tests (Node's test runner) and renderer
tests (Vitest with jsdom). The engine keeps its existing Node tests. Use the pinned
pnpm, TypeScript, oxfmt, and oxlint; dependencies retain the release-age policy.

## Isolation

The app has no host mounts, Docker socket, credentials, or outbound network.
Its internal Docker bridge uses isolated gateway mode. A separate nginx ingress
forwards the development port, bound only to `127.0.0.1`. Dependency downloads
happen during image builds. Compose Watch copies only this repository's source
one way into the container; host edits persist and container edits are disposable.

Outside Docker, `pnpm install` then `pnpm dev:web` runs the same preview bound to
`127.0.0.1` with the filesystem access of your account. `LOBSTER_WORKSPACE`,
`LOBSTER_WEB_HOST`, and `LOBSTER_WEB_PORT` override the workflow workspace and
listening address. `LOBSTER_WORKSPACE` contains a `workflows/` directory.
Docker remains the isolated development default.
