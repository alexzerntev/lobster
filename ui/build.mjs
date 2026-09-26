import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("./", import.meta.url));
await rm(new URL("dist/", import.meta.url), { recursive: true, force: true });
await build({
	absWorkingDir: root,
	entryPoints: ["src/index.ts"],
	outfile: "dist/browser/index.js",
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: true,
	legalComments: "inline",
});
await build({
	absWorkingDir: root,
	entryPoints: ["server/index.ts"],
	outfile: "dist/ui/server/index.js",
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	external: ["ajv", "yaml", "chokidar"],
});
// Keep the inspected built-in at the same relative path as the source API.
// It is read as text, never imported or executed by the viewer.
await mkdir(new URL("dist/src/workflows/", import.meta.url), { recursive: true });
await copyFile(
	new URL("../src/workflows/github_pr_monitor.ts", import.meta.url),
	new URL("dist/src/workflows/github_pr_monitor.ts", import.meta.url),
);
await copyFile(new URL("../LICENSE", import.meta.url), new URL("dist/LICENSE", import.meta.url));
// Declarations are usable by consumers without our ambient CSS/Node configuration.
await copyFile(
	new URL("src/assets.d.ts", import.meta.url),
	new URL("dist/assets.d.ts", import.meta.url),
);
await writeFile(
	new URL("dist/index.d.ts", import.meta.url),
	'/// <reference types="node" />\n/// <reference path="./assets.d.ts" />\nexport * from "./types/ui/src/index.js";\n',
);
await writeFile(
	new URL("dist/server.d.ts", import.meta.url),
	'/// <reference types="node" />\nexport * from "./types/ui/server/index.js";\n',
);
