# Lobster workflow viewer

Use this development UI to inspect workflow definitions and their source while
working on Lobster. Everything lives in this repository. No OpenClaw checkout,
Gateway, model, or credentials are needed. The viewer reads files and renders
static graphs; it does not execute workflows, approve actions, submit input, or
save edits. Use your editor to change files.

## Prerequisites

Check out the repository branch containing this viewer. Run the commands below
from its root, where `package.json`, `ui/`, and `dev/web/` exist. Installing the
published CLI package alone does not install the development viewer.

For the isolated Docker setup you need:

- Docker running Linux containers, with Engine 28 or newer. The internal bridge
  uses [isolated gateway mode](https://docs.docker.com/engine/release-notes/28/).
- Docker Compose 2.32 or newer, including
  [Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/).
- Bash and Python 3 on the host; Python starts the background file watcher.
- Port 5180 available on localhost and network access for the first image build.
  Dependencies are downloaded during builds; the running app has no outbound network.

Docker Desktop supplies the engine and Compose. On Windows, use a WSL2 Linux
shell with Docker integration; the launcher is a Bash script, not a PowerShell
script. Host Node.js and pnpm are not needed for the Docker path.

## Start and stop

```sh
./dev/web/dev up
```

The first build installs pinned dependencies and may take several minutes.
Startup checks prerequisites and waits for the app to become healthy. Open
<http://127.0.0.1:5180>. You should see built-in workflows and the checked-in
**hello-test**, **Node types**, and child-workflow examples.

```sh
./dev/web/dev stop
```

Stopping ends the file watcher and stops the preview containers. It does not
remove workflow files. Examples are committed fixtures, not generated seed data.
Run `up` again to resume development. The launcher uses one Compose project and
port; run only one checkout's preview at a time.

| Command                 | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `./dev/web/dev up`      | Build if needed, start the preview, and start file synchronization.          |
| `./dev/web/dev status`  | Show container state and health.                                             |
| `./dev/web/dev logs`    | Follow app and ingress logs; Ctrl+C stops following logs.                    |
| `./dev/web/dev test`    | Run development API/host and viewer tests inside the running app.            |
| `./dev/web/dev check`   | Run build, lint, typechecks, and the full test suite inside the running app. |
| `./dev/web/dev shell`   | Open a container shell at the repository root (`/app`).                      |
| `./dev/web/dev rebuild` | Rebuild and restart after dependency or configuration changes.               |
| `./dev/web/dev stop`    | Stop this preview and its background watcher.                                |

`test`, `check`, and `shell` require a running app. Edit on the host: container
changes are disposable and are not copied back into your checkout.

## Your first walkthrough

1. Search the list by workflow name or description. The Source column distinguishes
   workflow files from built-ins. Select **Node types** to explore the examples.
2. In **Flow**, drag the background to pan and use the lower-left zoom and fit
   controls. Node cards show their name, type badge, and fields. Colors follow
   the current light or dark theme.
3. Click a **Subworkflow** card to inspect its child in a dialog. Close the dialog
   to return to the parent. Click a recognized filename inside a card to open
   that file in **Code** instead.
4. Switch to **Code** for the original definition and syntax highlighting. Choose
   files in the side tree to inspect companion scripts and child definitions.
   This is read-only; edits happen in your editor.
5. Use the back arrow to return to the list. Open a built-in such as
   **github.pr.monitor** to see its single implementation card and clickable
   TypeScript source file. The viewer does not infer steps from JavaScript.

### Reading the graph

| Card            | Meaning                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Command         | A shell `run` or `command` step.                                                                                          |
| Pipeline        | A native Lobster `pipeline`, not necessarily shell code.                                                                  |
| Subworkflow     | A referenced workflow file. Literal relative paths can open a child dialog.                                               |
| Parallel / Join | Separate branch cards fan out and then meet at a join showing the wait mode.                                              |
| Loop            | A container with body steps stacked vertically. “next step” advances within the body; “next item” returns along the side. |
| Approval        | A human approval gate; approval markers can also appear on other cards.                                                   |
| Input           | A preview of the response schema: fields, types, required markers, and enum choices. It cannot submit a response.         |
| Step            | A generic fallback for graph data without a more specific kind.                                                           |
| Built-in        | One opaque implementation reference, rather than a parsed step sequence.                                                  |

The engine's JSON graph keeps parallel groups and loops as single nodes. The UI
expands their metadata for display without changing execution or Mermaid, DOT,
ASCII, or JSON output. Graph fields are display summaries: for example, command
cards suppress literal `\n` sequences. Use **Code** for the exact saved source.

### Themes and connection states

Open `http://127.0.0.1:5180/?theme=light` or `?theme=dark` to check either theme.
Without an override the preview follows the system preference. Add `?host=offline`
to inspect the disconnected state; remove it to reconnect. There is no authentication
or model-setup step for this viewer.

## Editing workflows and UI code

The default workspace is `dev/web/workspace/`. Its `workflows/` directory contains
`.lobster`, `.yaml`, `.yml`, or `.json` definitions, including nested directories.
Start by opening `dev/web/workspace/workflows/hello-test.lobster` in your editor.
Change its name or a command, save, and watch the list or open graph update.
Restore temporary demo edits before committing unless they are part of your change.

Compose Watch copies `src/`, `test/`, `ui/`, and `dev/web/` into the container.
Vite updates browser code; `tsx watch` restarts the server when imported server
code changes. A filesystem event stream refreshes the list, graph, and source
explorer after workflow edits, additions, renames, and deletions. No Refresh button
is needed. Built-in implementation changes restart the server as source changes.

Rebuild after editing root configuration, a dependency manifest, the lockfile,
Dockerfiles, or Compose configuration. Editing a manifest alone does not install
its dependencies. Do not run `pnpm install` inside the isolated running app: it
has no outbound network. Dependency installation belongs in the image build.

Companion JavaScript, TypeScript, shell, Python, Markdown, and text files must be
inside `workflows/` to appear in the source tree. Files are read on selection;
they are never imported or executed. Literal, unambiguous references to known
files become clickable links. The tree does not infer dependencies from arbitrary
shell commands. Dynamic child paths containing runtime expressions cannot open
in the static viewer; inspect their definition in Code.

Hidden paths, `node_modules`, symlinks, hardlinks, and files over 256 KiB are
excluded from source inspection. The source tree shows truncation when its
100-file, 1,000-entry, or eight-directory-depth limit is reached. The workflow
catalog reports an error if it exceeds 100 workflow files or 1,000 entries.
Malformed workflow syntax remains available in Code when its source is readable;
fix the file and save to restore its graph.

## Where to make changes

| Responsibility                                                  | Owner                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Workflow syntax, validation, execution, and native graph output | `src/workflows/`                                                            |
| Shared native node kinds and graph types                        | `src/workflows/graph-types.ts`                                              |
| Workflow list and search                                        | `ui/src/workflows.ts`                                                       |
| Cards, Flow/Code toggle, and mounted viewer lifecycle           | `ui/src/graph.ts`                                                           |
| Display-only branches and nested loop steps                     | `ui/src/graph-projection.ts`                                                |
| Node placement and edge routing                                 | `ui/src/graph-layout.ts` (Dagre)                                            |
| Input schema previews                                           | `ui/src/input-preview.ts` and `input-schema.ts`                             |
| Source tree, file links, and child dialogs                      | `ui/src/source-explorer.ts`, `source-links.ts`, and `subworkflow-dialog.ts` |
| Shared colors, fonts, and controls                              | `ui/theme/`; viewer-specific CSS is `ui/src/styles.css`                     |
| Read-only file API, filesystem events, and HTTP server          | `dev/web/dev-api.ts` and `server.ts`                                        |
| Local navigation, connection, dialogs, and mount lifecycle      | `dev/web/preview-host.ts`, `dialog.ts`, and `main.ts`                       |
| Example definitions used by both the preview and tests          | `dev/web/workspace/workflows/`                                              |

`@lobster/ui` exports the list and workflow mount functions plus a small host
interface in `ui/src/view-context.ts`. This is the same renderer you edit and
see in the preview. A future embedding host implements that interface; it should
not copy the renderer. There is no OpenClaw SDK dependency or registration.
The local host implements supported inspection/navigation operations and rejects
unsupported methods; there are no chat, inference, approval, or execution endpoints.

One server watcher publishes workflow changes, with one event stream per browser
shell. Dispose subscriptions, requests, observers, timers, dialogs, and mounted
views when their owner is replaced or stopped. Preserve stale-request protection
so a late response cannot replace the selected workflow or file.

## Checks and fixture maintenance

With Docker running, use `./dev/web/dev test` for the web edit loop. Before
submitting a change, run:

```sh
./dev/web/dev rebuild
./dev/web/dev check
```

Rebuilding ensures all root configuration and dependency changes are included.
The full check runs the same commands used for local contributor validation:

```sh
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Engine tests use Node's test runner; development API/host tests use Node through
`tsx`; viewer tests use Vitest with jsdom. `pnpm test:web` selects just the latter
two suites. CI runs the build, CLI smoke check, lint, typechecks, and tests on
Node 22 and 24. Fork owners must enable GitHub Actions for remote checks to run;
a local pass does not mean CI ran.

The existing API suite discovers the checked-in examples and passes them through
the real loader, JSON graph output, and viewer projection. It checks source
inspection, child links, native node-kind coverage, and the branch/loop demo.
It does not execute example commands. Invalid inputs and specialized edge cases
belong in tests that create temporary fixtures, not in the default newcomer demo.

When adding or changing a native node kind:

1. Update the engine-owned `graphNodeTypes` contract and classifier together.
2. Update the viewer's exhaustive label map and any required card, projection,
   layout, or style behavior. Display-only `join` and `builtin` remain UI-owned.
3. Update the engine classification test and a small checked-in example in the
   same change. The generic `step` fallback is tested separately because valid
   top-level files require an execution, approval, or input field.
4. Run the checks and inspect the relevant flow, Code view, and both themes.

Typechecks catch missing type handling and fixture checks catch incompatible
examples. They cannot prove every workflow, command execution, or pixel-level
appearance. For visual changes, inspect the browser as well; jsdom cannot measure
React Flow's real layout and may emit layout/style warnings.

Keep `ui` and `dev/web` private. The root package's file allowlist and production
TypeScript build exclude them from the runtime tarball. Keep the production-mode
server guard, read-only API, and local asset/license notices intact. A live
execution dashboard and retained run history remain separate product decisions
in [VISION.md](../../VISION.md). Update this guide when commands or behavior change.

## Troubleshooting

| Symptom                                                     | What to check                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `dev/web/dev` is missing                                    | Check out the branch containing the viewer; the published CLI package does not include it.                                        |
| Startup reports missing Docker/Python or an old version     | Install the prerequisites above, start Docker, and retry `up`.                                                                    |
| Port 5180 is already allocated                              | Stop the other process or the other checkout's preview; then retry.                                                               |
| Build cannot fetch dependencies                             | Check host/Docker build network access. Keep the pinned pnpm and lockfile; do not delete the lockfile to bypass an install error. |
| Page is unavailable or shows a proxy error                  | Run `status`, then `logs`. The app must be healthy and ingress running.                                                           |
| Source edits do not appear                                  | Read `dev/web/.watch.log`; rerun `up` to restart synchronization. Rebuild for root config or dependency changes.                  |
| A module is missing after a pull or manifest edit           | Run `rebuild` so the image installs the current lockfile.                                                                         |
| Tests say the app is not running                            | Start it with `up`; `test`, `check`, and `shell` use the running container.                                                       |
| A workflow is absent                                        | Clear search; check the suffix, workspace location, hidden/link exclusions, and catalog limits.                                   |
| A graph or child cannot open                                | Use Code to inspect validation errors or dynamic/out-of-workspace child paths. Fix and save the definition.                       |
| Input fields do not accept edits, or there is no Run button | This is a static inspector; edit files in your editor and run workflows separately through the CLI or a host.                     |

## Isolation and optional direct-host setup

The Docker app has no host mounts, Docker socket, credentials, or outbound
network. Its internal bridge uses isolated gateway mode; a separate nginx ingress
publishes only `127.0.0.1:5180`. Builds download dependencies. Watch copies source
one way from the host; container edits are disposable.

For developers who intentionally want to run on the host, install Node 24.15+
(24.x) or 22.22.2+ (22.x), which satisfy the viewer/test dependencies, and
the pnpm version in the root `packageManager` field, then run from the repository
root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web
```

This runs with your account's filesystem access. The default bind address is
`127.0.0.1`. In direct-host mode, `LOBSTER_WORKSPACE` selects a directory containing
`workflows/`, and `LOBSTER_WEB_HOST` / `LOBSTER_WEB_PORT` override the bind address
and port. For example, `LOBSTER_WORKSPACE=/absolute/path/to/my-workspace pnpm dev:web`
uses personal files outside the committed demos. These environment overrides are
not forwarded by the supplied Docker Compose setup. Docker remains the isolated
development default; never put credentials or personal workflow data in examples.
