# Lobster workflow viewer

`@clawdbot/lobster-viewer` provides embeddable workflow views and a read-only
inspection API. Hosts supply navigation, transport, and service lifetime;
OpenClaw's adapter lives in its existing `extensions/lobster/` plugin.

- Import `mountWorkflows`, `mountWorkflow`, and the `LobsterViewContext` host
  contract from `@clawdbot/lobster-viewer`; import its `styles.css` separately.
- The host supplies navigation, dialogs, read requests, change notifications,
  and theme tokens. `observeHostTheme` follows an embedding root's live theme.
  Dispose mounted views and abort their lifetime when leaving the host page.
- `@clawdbot/lobster-viewer/server` exports `createWorkflowApi(workspaceDir)`
  and `watchWorkflows`. One service owns the watcher; await `ready` and close
  it on shutdown. Inspection never executes workflow commands.

From the repository root, use `pnpm dev:web` for the same UI with hot reload,
`pnpm build:viewer` to build the library, and `pnpm test:viewer-package` to
verify the packed package outside the source tree. `pnpm --dir ui pack` creates
the library tarball. The engine's root tarball remains separate.

The development host aliases the library entry to its source so edits render
immediately without rebuilding. Packaged entries use built JavaScript and declarations. The server bundles inspection from this same engine revision
and includes built-in source as text; it does not need private engine imports
or an OpenClaw dependency at installation time.

See [UI development](../dev/web/README.md) for fixtures, checks, and file limits.
