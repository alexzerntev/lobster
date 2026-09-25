# Lobster UI development harness

This private workspace previews the OpenClaw Lobster plugin during development.
It is not a Lobster web product, production server, or new CLI/SDK API. The current
Lobster baseline has no web server; its engine still owns deterministic workflows,
while OpenClaw owns user interaction, authentication, and execution policy (see
[the vision](../../VISION.md)). The development API only reads definitions and
renders graphs with the local engine. It never executes workflows or requests
inference.

## Start in Docker

Keep the OpenClaw checkout beside this repository (`../openclaw`), with the Lobster
UI changes present. From the Lobster checkout:

```sh
./dev/web/dev up
```

Open <http://127.0.0.1:5180>. The page contains only the plugin view, with the actual
OpenClaw styles, fonts, and theme assets. There is no extra development title bar,
sidebar, or duplicate set of UI components. The plugin's own headings remain.
Use `?theme=light` or `?theme=dark` to preview a host theme; otherwise it follows
the system preference. Use `?host=offline` to exercise the disconnected state.
These are preview settings, not OpenClaw configuration.

```sh
./dev/web/dev status
./dev/web/dev logs
./dev/web/dev test
./dev/web/dev shell
./dev/web/dev stop
```

Stop another server on that port first. The previous OpenClaw development stack
can be stopped with `~/.local/share/openclaw-lobster-dev/dev stop`; its Docker data
volume is preserved.

## Source ownership and hot reload

- Plugin views: `../openclaw/extensions/lobster/browser/`. Both hosts mount these
  same modules. The preview does not maintain a second renderer.
- Host presentation: OpenClaw's `ui/src/styles/`, theme artwork, and bundled fonts.
  `host-styles.css` imports the relevant host styles in their original order;
  `shell.css` only allocates the content viewport without sidebar chrome.
- Lobster engine: `src/`. Changes restart the small development server.
- Development-only HTTP adapter: `dev/web/server.ts` and `dev/web/dev-api.ts`.
- Mock host and lifecycle: `dev/web/mock-host.ts` and `dev/web/main.ts`.
- Workflow fixtures: `dev/web/workspace/workflows/`. Edits, additions, renames,
  and deletions refresh the list, graph, and selected source file automatically.

The Code view includes a read-only tree of workflow definitions and companion
scripts under `workflows/`. Files are read when selected; the preview never imports
or executes them. YAML, JSON, JavaScript, TypeScript, shell, Python, Markdown, and
text files are supported. The tree does not infer dependencies from shell commands
or reveal files outside this directory. Built-ins expose their registered runtime
implementation only. Hidden paths, `node_modules`, symlinks, and hardlinks are
excluded. Reads are bounded to 256 KiB per file; trees stop at 100 files, 1,000
entries, or eight nested directories and indicate truncation. Invalid YAML remains
available to inspect.

Docker Compose Watch copies source changes one way into the container. Vite
updates browser modules and styles; `tsx watch` restarts server/engine changes.
One watcher publishes workflow changes. Streams, subscriptions, requests, timers,
and mounted views are disposed on replacement or shutdown. Run
`./dev/web/dev rebuild` after changing dependencies or Docker configuration.

## OpenClaw mock boundary

The preview mounts the plugin's minimal view contract, not the OpenClaw app or
Gateway. Only the capabilities actually used by the views are implemented:

| Host capability                                 | Development behavior                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Workflow list/get and source tree/file requests | Read-only local Lobster API; never forwarded to OpenClaw          |
| Page URLs and navigation                        | Local catalog/detail routes                                       |
| Connection and subscriptions                    | Local preview connection state and disposable listeners           |
| Workflow change events                          | Local filesystem invalidation through one SSE connection          |
| Error redaction                                 | Conservative mock masking; no OpenClaw credential store is loaded |

Unknown methods, events, page IDs, and parameters fail explicitly instead of
silently succeeding or contacting a Gateway. There are no session, chat, agent,
authentication, approval, or execution endpoints. When a view gains a new host
interaction, add a deliberate mock and boundary test before using it here.

## Maintenance and packaging

`dev/web` is a private workspace with development dependencies only. It has no
production build, package export, or CLI registration. The root package's file
allowlist and production TypeScript build exclude it. Startup rejects
`NODE_ENV=production`. Keep all server and mock code under this directory; the
engine must never import it.

The normal repository checks include harness formatting, lint, API/mock tests,
and server typechecking. They run without an OpenClaw checkout. Browser integration
typechecking also covers the actual shared views and requires the sibling checkout:

```sh
pnpm test:web
pnpm --filter @lobster/dev-web typecheck
```

Use the repository's pinned pnpm, TypeScript, oxfmt, oxlint, and Node test runner.
Dependencies retain the workspace release-age policy. Browser dependencies match
the plugin's versions; changes must be coordinated with its owner. Normal Lobster
builds and npm installation do not start or ship the preview.

## Isolation

The app has no host mounts, Docker socket, credentials, or outbound network.
Its internal Docker bridge uses isolated gateway mode. A separate nginx ingress
forwards the development port, bound only to `127.0.0.1`. No OpenClaw state or
credentials are copied. Only UI source, styles, and public font/theme assets are
copied from that checkout. Dependency downloads happen during image builds.
Host edits persist; edits inside the container are disposable.

Outside Docker, `pnpm install` then `pnpm dev:web` runs the preview bound to
`127.0.0.1` with the filesystem access of your account. `LOBSTER_UI_ROOT`,
`LOBSTER_OPENCLAW_UI_ROOT`, `LOBSTER_WORKSPACE`, `LOBSTER_WEB_HOST`, and
`LOBSTER_WEB_PORT` override paths/listening. `LOBSTER_WORKSPACE` contains a
`workflows/` directory. Docker remains the isolated development default.
