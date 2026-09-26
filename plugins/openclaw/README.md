# Lobster viewer for OpenClaw

An optional, read-only OpenClaw plugin using the same viewer as `pnpm dev:web`.
It adds **Lobster** to the sidebar: search workflows, inspect graphs and nested
workflows, and browse highlighted definitions and referenced source files.
The existing Lobster execution plugin is separate; neither plugin requires the
other. This viewer does not run workflows, commands, or inference.

## Build and install

Use Node 24.16+ (24.x) or 26.1+, and the repository's pinned pnpm. From the
Lobster repository, install the normal UI dependencies with `pnpm install`, then:

```sh
cd plugins/openclaw
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm pack --out /tmp/lobster-viewer.tgz
openclaw plugins install npm-pack:/tmp/lobster-viewer.tgz --force
```

This optional package has its own lockfile so ordinary CLI/UI development does
not install OpenClaw. Its experimental SDK is pinned and tested against
OpenClaw **2026.9.6**. Check compatibility before changing that pin.

Enable **Settings → Labs → Custom plugin UI**, then open Lobster in the
Gateway's own Control UI on localhost or HTTPS. Follow the install command's
reload instructions. The native UI runs with the signed-in operator's authority;
install only a package you trust.

The viewer reads the host's default agent workspace under `workflows/`, including
supported code files in that directory, plus packaged built-in source. It inherits
the host's theme, navigation, dialogs, and read permissions. File changes update
open views automatically. Restart the Gateway after changing the default workspace.
No separate web server or development fixtures ship in this package.

## Maintain

Edit shared rendering in `ui/src/` and inspection/watch logic in `ui/server/`.
`src/` here only adapts those owners to public OpenClaw SDK interfaces. The build
bundles native JS/CSS, records immutable asset paths in the manifest, and copies
built-in source and license notices from their canonical owners. Generated `dist/`
and copied notices are not committed. Rebuild before packing or reinstalling.

Run the root checks as well as this package's checks. Test the **tarball** in an
isolated OpenClaw profile: sidebar/list, graph, code/file links, child dialog, live
file changes, theme changes, and a Gateway restart. Standalone tests alone do not
prove installation. Keep the manifest and host-version metadata current when
upgrading the SDK. Do not import OpenClaw internals or copy its standalone theme
into the installed UI.
