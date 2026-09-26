# Lobster UI development

The read-only viewer lives in `ui/`; `dev/web/` hosts it for development. It
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
loads. Pass OpenClaw's `host.subscribe` as the optional notification source; abort
the adapter with the host lifetime. Do not import the standalone theme stylesheet
when embedding into OpenClaw, which owns its palette.

Theme checks:

```sh
pnpm --filter @lobster/dev-web exec playwright install chromium --only-shell
pnpm test:web:browser
LOBSTER_OPENCLAW_ROOT=/path/to/openclaw pnpm test:theme:openclaw
```

The first suite exercises the real preview, computed colors, child dialogs, source
selection, and viewport preservation; CI runs it on Node 24. The optional second
suite loads the selected checkout's actual theme producer and palettes, including a
delayed stylesheet. Only preferences and Gateway transport are synthetic; it does
not test OpenClaw's full settings shell or plugin installation. Run it when changing
the adapter or supported OpenClaw revision. Missing source contracts fail visibly.
Normal `pnpm dev:web` still needs neither OpenClaw nor a browser install.
The optional harness is enabled only by `LOBSTER_OPENCLAW_ROOT` and uses port 5192;
normal development stays on 5180. Browser processes and the test server close after
checks. The standalone palette copy is not automatically synchronized upstream.

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
- `dev/web/server.ts`: development-only HTTP/SSE transport. `preview-host.ts`,
  `dialog.ts`, and `main.ts` own local navigation and lifecycle.
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
one event stream per browser shell. The viewer library is packaged separately; `dev/web` stays private. Both are excluded
from the engine runtime tarball; the server rejects `NODE_ENV=production`.

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
`LOBSTER_WEB_HOST` / `LOBSTER_WEB_PORT` change the bind address and port.
Keep personal data out of committed examples.
