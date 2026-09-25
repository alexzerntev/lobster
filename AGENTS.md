# AGENTS.md

Guidance for coding assistants operating in this repository.

## Viewer Development

- Read [dev/web/README.md](dev/web/README.md) before changing the viewer or its development server.
- Keep the viewer in `ui/` and the read-only development harness in `dev/web/`; neither belongs in runtime execution or the published package.
- The engine owns graph node types in `src/workflows/graph-types.ts`. Update renderer handling and checked-in examples together when changing this contract.
- Use the guide's Docker commands for isolated development and validation. The preview must not execute workflows or request credentials.
- Update the guide when changing setup, user-visible features, or maintenance commands.

## When To Use Lobster

- Prefer `lobster` for multi-step or repeatable workflows.
- Use direct shell commands for simple one-off tasks.
- Prefer deterministic pipelines/workflows over ad-hoc LLM re-planning loops.

## Invocation Contract

- Use tool mode for machine-readable output:
  - `lobster run --mode tool '<pipeline>'`
  - `lobster run --mode tool --file <workflow.lobster> --args-json '<json>'`
- If `lobster` is not on `PATH`, use:
  - `node bin/lobster.js ...`

## Approval And Resume

- Treat `status: "needs_approval"` as a hard stop.
- Never auto-approve on behalf of a user.
- Resume only after explicit user decision:
  - `lobster resume --token <resumeToken> --approve yes|no`

## Output Handling

- Parse the tool envelope JSON fields: `ok`, `status`, `output`, `requiresApproval`, `error`.
- On `ok: false`, surface the error and stop.

## Safety And Shell Usage

- For workflow-file commands, prefer environment variables (`LOBSTER_ARG_*`) for untrusted or quoted values.
- Avoid embedding unsafe user strings directly into shell command text.
