import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { resolveWorkflowArgs } from "../../src/workflows/file.js";
import { renderWorkflowGraph } from "../../src/workflows/graph.js";
import { graphNodeTypes } from "../../src/workflows/graph-types.js";
import { loadWorkflowFile } from "../../src/workflows/load.js";
import { projectWorkflowGraph } from "../../ui/src/graph-projection.js";
import { subworkflowTarget } from "../../ui/src/subworkflow-target.js";
import { createWorkflowApi, WorkflowApiError } from "./dev-api.js";

function fileId(filename: string): string {
	return `file:${Buffer.from(filename).toString("base64url")}`;
}

async function fixture(t: TestContext) {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "lobster-web-test-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	await mkdir(path.join(workspace, "workflows"));
	return { workspace, api: createWorkflowApi(workspace) };
}

test("checked-in preview workflows stay discoverable, inspectable, and visualizable", async (t) => {
	const workspace = fileURLToPath(new URL("./workspace/", import.meta.url));
	const directory = path.join(workspace, "workflows");
	const filenames = (await readdir(directory, { recursive: true }))
		.filter((filename) => /\.(?:lobster|ya?ml|json)$/iu.test(filename))
		.map((filename) => filename.split(path.sep).join("/"));
	assert.ok(filenames.length > 0, "The preview must have checked-in example workflows");
	const api = createWorkflowApi(workspace);
	const { workflows } = await api.list();
	assert.deepEqual(
		workflows
			.filter((workflow) => workflow.source === "file")
			.map(({ id }) => id)
			.sort(),
		filenames.map(fileId).sort(),
	);
	const coveredTypes = new Set<string>();
	for (const filename of filenames) {
		await t.test(filename, async () => {
			const { workflow } = await api.get(fileId(filename));
			assert.equal(workflow.unavailableReason, undefined);
			assert.ok(workflow.graph?.nodes.length, "The example must have a usable graph");
			assert.equal(
				workflow.definition?.text,
				await readFile(path.join(directory, filename), "utf8"),
			);
			const tree = await api.files(workflow.id);
			assert.equal(tree.defaultPath, filename);
			assert.equal(tree.truncated, false);
			assert.ok(tree.files.some((file) => file.path === filename));
			assert.equal((await api.file(workflow.id, filename)).file.text, workflow.definition.text);
			const projected = projectWorkflowGraph(workflow);
			const ids = new Set(projected.nodes.map((node) => node.id));
			assert.equal(ids.size, projected.nodes.length);
			for (const edge of projected.edges) {
				assert.ok(ids.has(edge.from) && ids.has(edge.to), `Dangling edge: ${JSON.stringify(edge)}`);
			}
			for (const node of workflow.graph.nodes) {
				coveredTypes.add(node.type);
				assert.ok(ids.has(node.id), `Missing visual node: ${node.id}`);
				if (node.type === "workflow") {
					const target = subworkflowTarget(workflow, node.id);
					assert.ok(tree.files.some((file) => file.path === target.filename));
					const { workflow: child } = await api.get(target.id);
					assert.equal(child.unavailableReason, undefined);
					assert.ok(child.graph?.nodes.length, `Unavailable child: ${target.filename}`);
				}
			}
		});
	}
	// "step" is the renderer's generic fallback; the file loader requires an
	// execution, approval, or input field. Its fallback cases live in UI tests.
	assert.deepEqual(
		[...coveredTypes].sort(),
		graphNodeTypes.filter((type) => type !== "step").sort(),
		"Keep the preview examples in sync with supported workflow node kinds",
	);
});

test("node-types preview keeps two branches and a multi-step loop to inspect", async () => {
	const api = createWorkflowApi(fileURLToPath(new URL("./workspace/", import.meta.url)));
	const { workflow } = await api.get(fileId("node-types.lobster"));
	assert.equal(workflow.unavailableReason, undefined);
	const { nodes, edges } = projectWorkflowGraph(workflow);
	const parallel = nodes.find((node) => node.type === "parallel");
	assert.ok(parallel);
	assert.equal(
		edges.filter((edge) => edge.from === parallel.id && edge.label === "branch").length,
		2,
	);
	const loop = nodes.find((node) => node.type === "for_each");
	assert.ok(loop?.isContainer);
	const steps = nodes.filter((node) => node.parentId === loop.id);
	assert.equal(steps.length, 2);
	assert.ok(
		edges.some(
			(edge) => edge.from === steps[0].id && edge.to === steps[1].id && edge.label === "next step",
		),
	);
	assert.ok(
		edges.some(
			(edge) => edge.from === steps[1].id && edge.to === steps[0].id && edge.label === "next item",
		),
	);
});

test("catalog discovers nested workflows and keeps malformed files visible", async (t) => {
	const { workspace, api } = await fixture(t);
	await mkdir(path.join(workspace, "workflows", "nested"));
	await writeFile(
		path.join(workspace, "workflows", "nested", "sample.lobster"),
		"name: Sample\ndescription: My workflow\nsteps:\n  - id: hello\n    command: echo hello\n",
	);
	await writeFile(path.join(workspace, "workflows", "broken.yaml"), "steps: [");
	await writeFile(path.join(workspace, "workflows", "ignored.txt"), "not a workflow");
	const { workflows } = await api.list();
	assert.deepEqual(
		workflows.filter((workflow) => workflow.source === "file"),
		[
			{ id: fileId("broken.yaml"), name: "broken", source: "file" },
			{
				id: fileId("nested/sample.lobster"),
				name: "Sample",
				description: "My workflow",
				source: "file",
			},
		],
	);
	const { workflow } = await api.get(fileId("broken.yaml"));
	assert.equal(workflow.definition?.text, "steps: [");
	assert.equal(workflow.graph, undefined);
	assert.ok(workflow.unavailableReason);
});

test("native graph topology and defaults are preserved without executing commands", async (t) => {
	const { workspace, api } = await fixture(t);
	const filename = path.join(workspace, "workflows", "sequence.lobster");
	const source = stringify({
		name: "Sequence",
		args: { message: { default: "hello" } },
		steps: [
			{ id: "start", run: "printf '${message}\\n'" },
			{ id: "confirm", approval: true, stdin: "$start.stdout" },
			{
				id: "pipe",
				pipeline: "head --count 1 | json",
				stdin: "$start.stdout",
				when: "$confirm.approved",
			},
			{ id: "nested", workflow: "child.lobster", workflow_args: { value: "${message}" } },
			{
				id: "parallel",
				parallel: {
					wait: "all",
					branches: [
						{ id: "left", command: "echo left" },
						{ id: "right", command: "echo right" },
					],
				},
			},
			{ id: "each", for_each: "$pipe.json", steps: [{ id: "body", command: "echo ${item}" }] },
			{ id: "input", input: { prompt: "Value?", responseSchema: { type: "string" } } },
		],
	});
	await writeFile(filename, source);
	const loaded = await loadWorkflowFile(filename);
	const native = JSON.parse(
		renderWorkflowGraph({
			workflow: loaded,
			format: "json",
			args: resolveWorkflowArgs(loaded.args, {}),
		}),
	);
	const { workflow } = await api.get(fileId("sequence.lobster"));
	assert.equal(workflow.unavailableReason, undefined);
	assert.deepEqual(workflow.graph, native);
	assert.deepEqual(
		workflow.steps?.map((step) => step.id),
		native.nodes.map((node: { id: string }) => node.id),
	);
	assert.deepEqual(workflow.steps?.[0].fields, [
		{ name: "run", value: "printf '${message}'", language: "bash" },
	]);
	assert.equal(workflow.definition?.text, source);
	assert.match(workflow.graph!.nodes[0].label, /hello/);
	assert.equal(
		workflow.graph!.nodes.some((node) => ["body", "left", "right"].includes(node.id)),
		false,
	);
});

test("native parallel nodes retain nested branch fields and approval for the viewer", async (t) => {
	const { workspace, api } = await fixture(t);
	const source = stringify({
		steps: [
			{ id: "before", run: "echo before" },
			{
				id: "parallel",
				parallel: {
					wait: "any",
					timeout_ms: 1000,
					branches: [
						{ id: "shell", command: "printf 'value\\n'", env: { EXAMPLE: "value" } },
						{ id: "pipe", pipeline: "json", stdin: "$before.stdout" },
					],
				},
				approval: { prompt: "Continue after branches?" },
			},
			{ id: "finish", run: "cat", stdin: "$parallel.stdout" },
		],
	});
	await writeFile(path.join(workspace, "workflows", "parallel.yaml"), source);
	const { workflow } = await api.get(fileId("parallel.yaml"));
	assert.equal(workflow.unavailableReason, undefined);
	assert.deepEqual(
		workflow.graph?.nodes.map(({ id }) => id),
		["before", "parallel", "finish"],
	);
	assert.equal(workflow.graph?.nodes[1]?.shape, "diamond");
	const fields = (id: string) =>
		Object.fromEntries(
			workflow
				.steps!.find((step) => step.id === id)!
				.fields.map(({ name, value, language }) => [
					name,
					language === "bash" ? value : parse(value),
				]),
		);
	assert.deepEqual(fields("parallel"), {
		parallel: {
			wait: "any",
			timeout_ms: 1000,
			branches: [
				{ id: "shell", command: "printf 'value'", env: { EXAMPLE: "value" } },
				{ id: "pipe", pipeline: "json", stdin: "$before.stdout" },
			],
		},
		approval: { prompt: "Continue after branches?" },
	});
	assert.ok(
		workflow.graph!.edges.some(
			(edge) => edge.from === "parallel" && edge.to === "finish" && edge.label === "stdin",
		),
	);
	assert.equal(workflow.definition?.text, source);
});

test("built-ins expose their implementation source and no invented step graph", async (t) => {
	const { api } = await fixture(t);
	for (const name of ["github.pr.monitor", "github.pr.monitor.notify"]) {
		const { workflow } = await api.get(`builtin:${name}`);
		assert.equal(workflow.name, name);
		assert.equal(workflow.source, "builtin");
		assert.equal(workflow.graph, undefined);
		assert.equal(workflow.definition?.language, "typescript");
		assert.equal(workflow.definition?.filename, "src/workflows/github_pr_monitor.ts");
		assert.equal(
			workflow.definition?.text,
			await readFile(new URL("../../src/workflows/github_pr_monitor.ts", import.meta.url), "utf8"),
		);
	}
	await assert.rejects(
		api.get("builtin:unknown"),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
});

test("invalid native workflow semantics retain saved code and explain the failure", async (t) => {
	const { workspace, api } = await fixture(t);
	const source = JSON.stringify({
		name: "Invalid",
		steps: [{ id: "both", run: "echo hi", pipeline: "json" }],
	});
	await writeFile(path.join(workspace, "workflows", "bad.json"), source);
	const { workflow } = await api.get(fileId("bad.json"));
	assert.equal(workflow.definition?.language, "json");
	assert.equal(workflow.definition?.text, source);
	assert.equal(workflow.graph, undefined);
	assert.match(workflow.unavailableReason!, /can only define one/);
});

test("rejects traversal, malformed IDs, and symlink or hardlink escapes", async (t) => {
	const { workspace, api } = await fixture(t);
	const outside = path.join(workspace, "outside.yaml");
	const secret = "name: Never show this\nsteps:\n  - id: outside\n    run: echo secret\n";
	await writeFile(outside, secret);
	for (const id of [
		fileId("../outside.yaml"),
		fileId("/outside.yaml"),
		fileId("nested/../outside.yaml"),
		fileId("nested\\outside.yaml"),
		"file:!",
		"other:value",
	]) {
		await assert.rejects(
			api.get(id),
			(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 400,
		);
	}
	await symlink(outside, path.join(workspace, "workflows", "linked.yaml"));
	await symlink(workspace, path.join(workspace, "workflows", "linked-dir"));
	await link(outside, path.join(workspace, "workflows", "hardlink.yaml"));
	for (const filename of ["linked.yaml", "linked-dir/outside.yaml", "hardlink.yaml"]) {
		const { workflow } = await api.get(fileId(filename));
		assert.equal(workflow.definition, undefined);
		assert.equal(workflow.graph, undefined);
		assert.ok(workflow.unavailableReason);
		assert.equal(JSON.stringify(workflow).includes("Never show this"), false);
	}
	const { workflows } = await api.list();
	assert.equal(
		workflows.some((workflow) => workflow.id === fileId("linked.yaml")),
		false,
	);
	assert.equal(
		workflows.some((workflow) => workflow.id === fileId("linked-dir/outside.yaml")),
		false,
	);
	await assert.rejects(
		api.get(fileId("missing.yaml")),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
});

test("rejects a symlinked catalog root", async (t) => {
	const { workspace, api } = await fixture(t);
	await rm(path.join(workspace, "workflows"), { recursive: true });
	await symlink(workspace, path.join(workspace, "workflows"));
	await assert.rejects(api.list(), /without symlinks/);
});

test("bounds document bytes, nested step counts, and cyclic YAML aliases", async (t) => {
	const { workspace, api } = await fixture(t);
	await writeFile(path.join(workspace, "workflows", "large.yaml"), " ".repeat(256 * 1024 + 1));
	const { workflow: large } = await api.get(fileId("large.yaml"));
	assert.equal(large.definition, undefined);
	assert.match(large.unavailableReason!, /256 KiB/);
	await writeFile(
		path.join(workspace, "workflows", "steps.json"),
		JSON.stringify({
			steps: [
				{
					id: "loop",
					for_each: "$start.json",
					steps: Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, run: "echo x" })),
				},
			],
		}),
	);
	const { workflow: steps } = await api.get(fileId("steps.json"));
	assert.equal(steps.graph, undefined);
	assert.ok(steps.definition);
	assert.match(steps.unavailableReason!, /500 steps/);
	await writeFile(
		path.join(workspace, "workflows", "branches.json"),
		JSON.stringify({
			steps: [
				{
					id: "parallel",
					parallel: {
						branches: Array.from({ length: 500 }, (_, i) => ({ id: `b${i}`, run: "echo branch" })),
					},
				},
			],
		}),
	);
	const { workflow: branches } = await api.get(fileId("branches.json"));
	assert.equal(branches.graph, undefined);
	assert.match(branches.unavailableReason!, /500 steps/);
	await writeFile(
		path.join(workspace, "workflows", "cycle.yaml"),
		"steps:\n  - &loop\n    id: loop\n    run: echo x\n    stdin: *loop\n",
	);
	const { workflow: cyclic } = await api.get(fileId("cycle.yaml"));
	assert.equal(cyclic.graph, undefined);
	assert.ok(cyclic.definition);
	assert.match(cyclic.unavailableReason!, /circular YAML aliases/);
});

test("catalog bounds file and directory entry counts", async (t) => {
	const { workspace, api } = await fixture(t);
	const directory = path.join(workspace, "workflows");
	await Promise.all(
		Array.from({ length: 101 }, (_, i) =>
			writeFile(path.join(directory, `${i}.yaml`), "steps: []"),
		),
	);
	await assert.rejects(api.list(), /100 workflow files/);
	await rm(directory, { recursive: true });
	await mkdir(directory);
	await Promise.all(
		Array.from({ length: 1001 }, (_, i) => writeFile(path.join(directory, `${i}.txt`), "")),
	);
	await assert.rejects(api.list(), /1000 entries/);
});

test("source explorer lists workflow and companion sources without parsing or executing them", async (t) => {
	const { workspace, api } = await fixture(t);
	const directory = path.join(workspace, "workflows");
	await mkdir(path.join(directory, "scripts"));
	await mkdir(path.join(directory, ".hidden"));
	await mkdir(path.join(directory, "node_modules"));
	await Promise.all([
		writeFile(path.join(directory, "broken.yaml"), "steps: ["),
		writeFile(path.join(directory, "scripts", "helper.JS"), "throw new Error('Never execute');"),
		writeFile(path.join(directory, "scripts", "read.py"), "print('hello')"),
		writeFile(path.join(directory, "notes.md"), "# Notes"),
		writeFile(path.join(directory, ".hidden", "private.js"), "hidden"),
		writeFile(path.join(directory, ".env.js"), "hidden"),
		writeFile(path.join(directory, "node_modules", "dependency.js"), "dependency"),
		writeFile(path.join(directory, "image.png"), "binary"),
	]);
	const id = fileId("broken.yaml");
	assert.deepEqual(await api.files(id), {
		defaultPath: "broken.yaml",
		truncated: false,
		files: [
			{ path: "broken.yaml", language: "yaml" },
			{ path: "notes.md", language: "plaintext" },
			{ path: "scripts/helper.JS", language: "javascript" },
			{ path: "scripts/read.py", language: "python" },
		],
	});
	assert.deepEqual(await api.file(id, "scripts/helper.JS"), {
		file: {
			path: "scripts/helper.JS",
			language: "javascript",
			text: "throw new Error('Never execute');",
		},
	});
	assert.equal((await api.file(id, "broken.yaml")).file.text, "steps: [");
	await writeFile(path.join(directory, "scripts", "helper.JS"), "// updated on disk");
	assert.equal((await api.file(id, "scripts/helper.JS")).file.text, "// updated on disk");
});

test("source explorer rejects untrusted paths and link escapes at the read boundary", async (t) => {
	const { workspace, api } = await fixture(t);
	const directory = path.join(workspace, "workflows");
	const id = fileId("sample.yaml");
	await writeFile(path.join(directory, "sample.yaml"), "steps: [");
	const outside = path.join(workspace, "outside.js");
	await writeFile(outside, "private source");
	await symlink(outside, path.join(directory, "linked.js"));
	await symlink(workspace, path.join(directory, "linked-dir"));
	await link(outside, path.join(directory, "hardlink.js"));
	await writeFile(path.join(directory, "large.js"), " ".repeat(256 * 1024 + 1));
	for (const filename of [
		"../outside.js",
		"/outside.js",
		"nested/../outside.js",
		"nested\\outside.js",
		"./sample.yaml",
		".env.js",
		".hidden/file.js",
		"node_modules/file.js",
		"file.exe",
		"nested//file.js",
		"file\0.js",
		"C:/file.js",
		`${"é".repeat(1023)}.js`,
	]) {
		await assert.rejects(
			api.file(id, filename),
			(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 400,
		);
	}
	await assert.rejects(
		api.files(fileId(`${"é".repeat(1023)}.yaml`)),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 400,
	);
	for (const filename of ["linked.js", "linked-dir/outside.js", "hardlink.js", "large.js"])
		await assert.rejects(api.file(id, filename));
	assert.deepEqual((await api.files(id)).files, [{ path: "sample.yaml", language: "yaml" }]);
	await assert.rejects(
		api.files(fileId("missing.yaml")),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
	await assert.rejects(
		api.file(fileId("missing.yaml"), "sample.yaml"),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
	await assert.rejects(
		api.file(id, "missing.js"),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
	await rm(directory, { recursive: true });
	await symlink(workspace, directory);
	await assert.rejects(api.files(id), /without symlinks/);
	await assert.rejects(api.file(id, "outside.js"), /without symlinks/);
});

test("source explorer bounds traversal and always keeps the active definition in a truncated tree", async (t) => {
	const { workspace, api } = await fixture(t);
	const directory = path.join(workspace, "workflows");
	const id = fileId("selected.yaml");
	await writeFile(path.join(directory, "selected.yaml"), "steps: []");
	await Promise.all(
		Array.from({ length: 101 }, (_, i) => writeFile(path.join(directory, `script-${i}.js`), "")),
	);
	const crowded = await api.files(id);
	assert.equal(crowded.files.length, 100);
	assert.equal(crowded.truncated, true);
	assert.ok(crowded.files.some((file) => file.path === "selected.yaml"));
	await rm(directory, { recursive: true });
	await mkdir(directory);
	await writeFile(path.join(directory, "selected.yaml"), "steps: []");
	const nested = Array.from({ length: 9 }, (_, index) => `dir-${index}`).join("/");
	await mkdir(path.join(directory, nested), { recursive: true });
	await writeFile(path.join(directory, nested, "deep.js"), "outside depth budget");
	const deep = await api.files(id);
	assert.equal(deep.truncated, true);
	assert.deepEqual(deep.files, [{ path: "selected.yaml", language: "yaml" }]);
	await assert.rejects(api.file(id, `${nested}/deep.js`), /Invalid source path/);
	await Promise.all(
		Array.from({ length: 1001 }, (_, i) => writeFile(path.join(directory, `image-${i}.png`), "")),
	);
	assert.equal((await api.files(id)).truncated, true);
});

test("built-in source explorer only exposes its registered implementation", async (t) => {
	const { api } = await fixture(t);
	const implementation = "src/workflows/github_pr_monitor.ts";
	for (const name of ["github.pr.monitor", "github.pr.monitor.notify"]) {
		const id = `builtin:${name}`;
		assert.deepEqual(await api.files(id), {
			files: [{ path: implementation, language: "typescript" }],
			defaultPath: implementation,
			truncated: false,
		});
		assert.equal(
			(await api.file(id, implementation)).file.text,
			(await api.get(id)).workflow.definition?.text,
		);
		await assert.rejects(
			api.file(id, "src/workflows/registry.ts"),
			(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
		);
	}
	await assert.rejects(
		api.files("builtin:unknown"),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
	await assert.rejects(
		api.file("builtin:unknown", implementation),
		(error: unknown) => error instanceof WorkflowApiError && error.statusCode === 404,
	);
});
