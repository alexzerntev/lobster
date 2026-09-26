import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";
import { build } from "esbuild";

const root = fileURLToPath(new URL("./", import.meta.url));
await mkdir(new URL("dist/", import.meta.url), { recursive: true });
await build({
	absWorkingDir: root,
	entryPoints: ["src/index.ts"],
	outfile: "dist/index.js",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: ["openclaw/*", "ajv", "yaml", "chokidar"],
});
// Preserve the source being inspected; it is never imported or executed by the viewer.
await copyFile(
	new URL("../../src/workflows/github_pr_monitor.ts", import.meta.url),
	new URL("dist/github_pr_monitor.ts", import.meta.url),
);
await copyFile(new URL("../../LICENSE", import.meta.url), new URL("LICENSE", import.meta.url));
await copyFile(
	new URL("../../ui/THIRD_PARTY_NOTICES.md", import.meta.url),
	new URL("THIRD_PARTY_NOTICES.md", import.meta.url),
);

// OpenClaw supports prebuilt native assets. Publish immutable, self-contained files.
const browser = await build({
	absWorkingDir: root,
	entryPoints: ["src/control-ui.ts"],
	outdir: "dist/control-ui",
	entryNames: "index",
	bundle: true,
	write: false,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: true,
	legalComments: "inline",
});
const hash = createHash("sha256");
for (const file of browser.outputFiles) {
	if (file.contents.length > 4 * 1024 * 1024)
		throw new Error("OpenClaw browser asset exceeds 4 MiB");
	hash.update(file.contents);
}
if (browser.outputFiles.reduce((size, file) => size + file.contents.length, 0) > 8 * 1024 * 1024)
	throw new Error("OpenClaw browser assets exceed 8 MiB");
const directory = `dist/control-ui/${hash.digest("hex").slice(0, 16)}`;
await mkdir(path.join(root, directory), { recursive: true });
for (const file of browser.outputFiles)
	await writeFile(path.join(root, directory, path.basename(file.path)), file.contents);
const manifestUrl = new URL("openclaw.plugin.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
manifest.controlUi = { entry: `${directory}/index.js`, styles: [`${directory}/index.css`] };
await writeFile(manifestUrl, JSON.stringify(manifest, null, "\t") + "\n");

// Only the current revision belongs in a newly packed artifact.
for (const entry of await readdir(path.join(root, "dist/control-ui"))) {
	if (entry !== path.basename(directory))
		await rm(path.join(root, "dist/control-ui", entry), { recursive: true, force: true });
}
