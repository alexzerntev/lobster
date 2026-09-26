import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);

test("packed viewer serves graphs and source without the checkout or an OpenClaw host", async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "lobster-viewer-package-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const artifact = path.join(directory, "viewer.tgz");
	await exec("pnpm", ["pack", "--out", artifact], {
		cwd: import.meta.dirname,
	});
	await writeFile(path.join(directory, "package.json"), '{"private":true,"type":"module"}\n');
	await exec("pnpm", ["add", "--prefer-offline", "--ignore-scripts", artifact], { cwd: directory });
	await mkdir(path.join(directory, "workflows"));
	await writeFile(
		path.join(directory, "workflows", "inspect.lobster"),
		"name: Inspect\nsteps:\n  - id: inspect\n    command: node helper.js\n",
	);
	await writeFile(
		path.join(directory, "workflows", "helper.js"),
		"throw new Error('Inspection must not execute this file');\n",
	);
	await writeFile(
		path.join(directory, "inspect.mjs"),
		`import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkflowApi, watchWorkflows } from '@clawdbot/lobster-viewer/server';
import { mountWorkflow, mountWorkflows } from '@clawdbot/lobster-viewer';
const api = createWorkflowApi(process.cwd());
const id = 'file:' + Buffer.from('inspect.lobster').toString('base64url');
assert.equal((await api.get(id)).workflow.graph.nodes[0].type, 'run');
assert.match((await api.file(id, 'helper.js')).file.text, /must not execute/);
const builtin = (await api.get('builtin:github.pr.monitor')).workflow;
assert.ok(builtin.definition.text.length > 100);
assert.equal(typeof mountWorkflow, 'function');
assert.equal(typeof mountWorkflows, 'function');
assert.match(await readFile(new URL(import.meta.resolve('@clawdbot/lobster-viewer/styles.css')), 'utf8'), /lobster-graph/);
const watcher = await watchWorkflows(process.cwd(), () => {}, (error) => { throw error; });
try { await watcher.ready; } finally { await watcher.close(); }
console.log(JSON.stringify({ source: builtin.definition.text }));
`,
	);
	const result = await exec(process.execPath, ["inspect.mjs"], { cwd: directory });
	assert.equal(
		JSON.parse(result.stdout).source,
		await readFile(new URL("../src/workflows/github_pr_monitor.ts", import.meta.url), "utf8"),
	);
	// Check declarations as a separate consumer too; no source aliases or skipLibCheck.
	await writeFile(
		path.join(directory, "consumer.ts"),
		`import { mountWorkflow, type LobsterView } from '@clawdbot/lobster-viewer';
const view: LobsterView = mountWorkflow;
export { view };
`,
	);
	await exec(
		process.execPath,
		[
			fileURLToPath(new URL("./bin/tsc", import.meta.resolve("typescript/package.json"))),
			"--ignoreConfig",
			"--noEmit",
			"--strict",
			"--module",
			"NodeNext",
			"--target",
			"ES2022",
			"consumer.ts",
		],
		{ cwd: directory },
	);
});
