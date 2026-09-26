# Lobster UI development

The read-only viewer lives in `ui/`; `dev/web/` hosts it for development. It
provides workflow search and pagination (20 rows at a time), React Flow graphs,
child-workflow dialogs, and highlighted source with a file tree. It uses the
local engine without executing workflows or requiring OpenClaw or credentials.

## Development

Requires Docker Engine 28+, Compose 2.32+, Bash, Python 3, and port 5180 available.
Run from the repository root:

```sh
./dev/web/dev up       # Build and start; open http://127.0.0.1:5180
./dev/web/dev test     # API/host and viewer tests
./dev/web/dev check    # Build, lint, typecheck, and all tests
./dev/web/dev stop     # Stop containers and file synchronization
```

Compose Watch copies `src/`, `test/`, `ui/`, and `dev/web/` into the container.
Vite updates the UI; `tsx watch` restarts server changes. Workflow edits,
additions, and deletions refresh the list, graph, and Code view automatically.
The footer matches OpenClaw Automations: shown/total count and “Load more” while
results remain. Search covers the full catalog and resets the visible limit; file
changes preserve it. Pagination does not change the catalog's read limits.

Use `./dev/web/dev rebuild` after root configuration, dependency, lockfile, or
Docker changes. `status` and `logs` diagnose startup failures; `.watch.log`
records synchronization failures. Rerun `up` to restart synchronization. `shell`
opens `/app`; container edits are disposable and do not copy back to the host.

Use `?theme=light` or `?theme=dark` to inspect themes (system preference by default),
and `?host=offline` for the disconnected state.

## Ownership and maintenance

- `ui/src/`: list, renderer, source explorer, input previews, and mount lifecycle.
  `graph-projection.ts` expands branches and loop bodies for display only;
  `graph-layout.ts` handles placement with Dagre. Code shows the original source.
- `ui/workflow-types.ts` and `ui/src/view-context.ts`: read-only data and host
  contracts with typed list, workflow, and source reads. Workflow fields stay
  structured until the UI formats them. Graph types come from `src/workflows/graph-types.ts`; native Mermaid,
  DOT, ASCII, and JSON topology and workflow execution remain engine-owned.
- `ui/theme/`: shared tokens, controls, fonts, and artwork; preserve `NOTICE.md`.
- `dev/web/server.ts` and `dev-api.ts`: bounded file reads and filesystem events.
  Listing reads metadata; opening a workflow invokes the engine's validator and graph renderer.
  `preview-host.ts`, `dialog.ts`, and `main.ts` own local navigation and lifecycle.
- `dev/web/workspace/workflows/`: checked-in synthetic examples shared with API
  tests. Startup reads them; shutdown leaves them in place.

When changing syntax or native node kinds, update the engine contract, exhaustive
viewer label map, and examples together. Existing tests discover the fixtures
and exercise the real loader, graph output, source reads, child links, and viewer
projection without executing commands. Keep invalid cases in temporary test
fixtures. Run `check` and inspect affected UI states; jsdom cannot verify layout.
Unexpected graph-rendering failures leave Code and navigation available; a file
change retries the graph without reloading the page.

The preview implements inspection/navigation only; unsupported host operations
fail explicitly. Preserve stale-request protection and dispose subscriptions,
requests, timers, dialogs, and views when replaced. One filesystem watcher serves
one event stream per browser shell. `ui` and `dev/web` stay private and excluded
from the runtime tarball; the server rejects `NODE_ENV=production`.

## File and isolation boundaries

The catalog reads `.lobster`, `.yaml`, `.yml`, and `.json` files under `workflows/`.
Code also exposes companion JS, TS, shell, Python, Markdown, and text files there.
Recognized file references open Code; literal child-workflow paths open dialogs.
Built-ins expose one implementation card and their registered source only.

Hidden paths, `node_modules`, symlinks, and hardlinks are excluded; reads are
limited to 256 KiB. The catalog errors above 100 workflow files or 1,000 entries;
the source tree indicates truncation at 100 files, 1,000 entries, or eight nested
directories. Invalid workflow definitions remain inspectable in Code.

The Docker app has no host mounts, Docker socket, credentials, or outbound
network. Its internal bridge uses isolated gateway mode; a separate ingress
binds only `127.0.0.1:5180`. Dependency downloads happen during image builds.

For intentional direct-host development, use Node 22.22.2+ (22.x) or 24.15+ (24.x)
and the pinned pnpm: `pnpm install --frozen-lockfile`, then `pnpm dev:web`.
`LOBSTER_WORKSPACE` selects a directory containing `workflows/`;
`LOBSTER_WEB_HOST` / `LOBSTER_WEB_PORT` change the bind address. These overrides
apply to direct-host mode, which runs with your account's filesystem access;
Compose does not forward them. Keep personal data out of committed examples.
