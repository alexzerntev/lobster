# Lobster UI development

The read-only viewer and standalone host live in `ui/`; `dev/web/` supplies
Vite and development fixtures. It
provides workflow search and pagination (20 rows at a time), React Flow graphs,
child-workflow dialogs, and highlighted source with a file tree. It uses the
local engine without executing workflows or requiring OpenClaw or credentials.

## Development

Requires Node 22.22.2+ (22.x) or 24.15+ (24.x), pnpm 12.5.1 (pinned in
`package.json`), and port 5180 available. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web          # Open http://127.0.0.1:5180; Ctrl+C to stop
pnpm test:web         # API/host and viewer tests
pnpm build            # CLI and built standalone assets
node bin/lobster.js view --workspace dev/web/workspace --port 5181
pnpm test:view-package # Install and exercise the packed CLI outside the checkout
```

If the `pnpm` launcher is unavailable, use `corepack pnpm` for these commands.

No build or Docker is needed. Vite serves the UI directly from source with native
file watching; `tsx watch` restarts server and imported engine changes. Workflow edits,
additions, and deletions refresh the list, graph, and Code view automatically.
The footer matches OpenClaw Automations: shown/total count and “Load more” while
results remain. Search covers the full catalog and resets the visible limit; file
changes preserve it. Pagination does not change the catalog's read limits.

Rerun `pnpm install --frozen-lockfile` after dependency or lockfile changes, then
restart `pnpm dev:web`. Startup and reload errors appear in the same terminal.
If port 5180 is occupied, stop the previous preview or set `LOBSTER_WEB_PORT`.

Use `?theme=light` or `?theme=dark` to inspect themes (system preference by default),
and `?host=offline` for the disconnected state.

The viewer consumes `host.theme.colorMode` and `host.theme.subscribe`; hosts supply
resolved light/dark state and inherited CSS tokens. `observeHostTheme(root, signal,
subscribe?)` adapts an embedding root once per host lifetime, including late palette
loads. Pass the host's subscription as the optional notification source; abort
the adapter with the host lifetime. Do not import the standalone theme stylesheet
when embedding into OpenClaw, which owns its palette.

Theme checks:

```sh
pnpm --filter @lobster/dev-web exec playwright install chromium --only-shell
pnpm test:web:browser
pnpm --filter @lobster/dev-web test:browser:built # After pnpm build
```

The browser suites exercise development and built hosts, computed colors, child dialogs,
source selection, and viewport preservation; CI runs it on Node 24. Unit tests
cover early host notifications, delayed stylesheets, and subscription disposal.
OpenClaw owns its adapter and application-theme checks in its repository.
Browser checks use port 5192 and close their processes and server after completion;
normal development stays on 5180 and needs no browser install. The standalone
palette copy is not automatically synchronized upstream.

## Ownership and maintenance

- `ui/src/`: list, renderer, source explorer, input previews, and mount lifecycle.
  `graph-projection.ts` expands branches and loop bodies for display only;
  `graph-layout.ts` handles placement with Dagre. Code shows the original source.
- `ui/workflow-types.ts` and `ui/src/view-context.ts`: read-only data and host
  contracts with typed list, workflow, and source reads. Workflow fields stay
  structured until the UI formats them. Graph types come from `src/workflows/graph-types.ts`; native Mermaid,
  DOT, ASCII, and JSON topology and workflow execution remain engine-owned.
- `ui/theme/`: shared tokens, controls, fonts, and artwork; preserve `NOTICE.md`.
- `ui/server/`: shared bounded file reads and lifecycle-owned filesystem watching.
  Listing reads metadata; opening a workflow invokes the engine's validator and graph renderer.
- `ui/standalone/`: shared local navigation, dialogs, theme, and HTTP/SSE transport.
  `server.ts` serves built assets for `lobster view`; it shares the inspection API
  and watcher with the Vite development host in `dev/web/server.ts`.
- `dev/web/vite.config.ts`: builds the standalone browser assets and copies source
  text and license notices. `pnpm build` and `pnpm test` prepare these assets so
  packaging with lifecycle scripts disabled still includes a complete viewer.
- OpenClaw’s `extensions/lobster/` owns plugin registration and its host adapter.
  It consumes the [viewer library](../../ui/README.md), with no development server.
- `dev/web/workspace/workflows/`: checked-in synthetic examples shared with API
  tests. Startup reads them; shutdown leaves them in place.

When changing syntax or native node kinds, update the engine contract, exhaustive
viewer label map, and examples together. Existing tests discover the fixtures
and exercise the real loader, graph output, source reads, child links, and viewer
projection without executing commands. Keep invalid cases in temporary test
fixtures. Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`, and
inspect affected UI states; jsdom cannot verify layout.
Unexpected graph-rendering failures leave Code and navigation available; a file
change retries the graph without reloading the page.

The preview implements inspection/navigation only; unsupported host operations
fail explicitly. Preserve stale-request protection and dispose subscriptions,
requests, timers, dialogs, and views when replaced. One filesystem watcher serves
all browser shells connected to each standalone server. The viewer library is
packaged separately; the CLI includes built standalone assets and loads its server
only for `view`. `dev/web` stays private; its Vite server rejects production mode.

## File boundaries

The catalog reads `.lobster`, `.yaml`, `.yml`, and `.json` files under `workflows/`.
Code also exposes companion JS, TS, shell, Python, Markdown, and text files there.
Recognized file references open Code; literal child-workflow paths open dialogs.
Built-ins expose one implementation card and their registered source only.

Hidden paths, `node_modules`, symlinks, and hardlinks are excluded; reads are
limited to 256 KiB. The catalog errors above 100 workflow files or 1,000 entries;
the source tree indicates truncation at 100 files, 1,000 entries, or eight nested
directories. Invalid workflow definitions remain inspectable in Code.

The server binds to `127.0.0.1:5180` by default and runs with your account's
filesystem permissions. Its API is read-only and does not execute workflow commands.
`LOBSTER_WORKSPACE` selects a directory containing `workflows/`;
`LOBSTER_WEB_PORT` changes the development port. The CLI uses `--workspace`
and `--port`; both hosts bind to loopback only.
Keep personal data out of committed examples.
