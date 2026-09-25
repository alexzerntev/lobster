import test from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
	renderWorkflowGraph,
	resolveWorkflowArgs,
	type WorkflowFile,
	type WorkflowGraph,
	type WorkflowGraphNodeType,
} from "../src/core/index.js";

function runCli(args: string[], env?: Record<string, string | undefined>) {
	const bin = path.join(process.cwd(), "bin", "lobster.js");
	return spawnSync(process.execPath, [bin, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

test("workflow graph classifies every native node kind", () => {
	const steps = {
		run: { id: "shell", command: "echo hello" },
		pipeline: { id: "pipe", pipeline: "json" },
		workflow: { id: "child", workflow: "child.lobster" },
		approval: { id: "approve", approval: true },
		input: { id: "input", input: { prompt: "Value?", responseSchema: { type: "string" } } },
		parallel: { id: "branches", parallel: { branches: [{ id: "branch", run: "echo branch" }] } },
		for_each: { id: "loop", for_each: "$shell.json", steps: [{ id: "body", run: "echo item" }] },
		// The graph renderer accepts an unclassified step even though the file loader rejects it.
		step: { id: "generic" },
	} satisfies Record<WorkflowGraphNodeType, WorkflowFile["steps"][number]>;
	const graph: WorkflowGraph = JSON.parse(
		renderWorkflowGraph({ workflow: { steps: Object.values(steps) }, format: "json" }),
	);
	assert.deepEqual(
		graph.nodes.map(({ id, type }) => ({ id, type })),
		Object.entries(steps).map(([type, step]) => ({ id: step.id, type })),
	);
});

test("workflow graph renderer outputs mermaid nodes and labeled edges", () => {
	const workflow = {
		args: { city: { default: "Phoenix" } },
		steps: [
			{ id: "fetch", run: "weather --json ${city}" },
			{ id: "confirm", approval: "Proceed?", stdin: "$fetch.json" },
			{
				id: "advice",
				pipeline: 'llm.invoke --prompt "Summarize this weather"',
				stdin: "$fetch.stdout",
				when: "$confirm.approved && $fetch.json.temp > 70",
			},
		],
	};

	const output = renderWorkflowGraph({ workflow, format: "mermaid", args: { city: "Seattle" } });
	assert.match(output, /^flowchart TD/m);
	assert.match(output, /fetch\["fetch\\nrun: weather --json Seattle"\]/);
	assert.match(output, /confirm\{"confirm\\napproval gate"\}/);
	assert.match(
		output,
		/advice\["advice\\npipeline: llm\.invoke --prompt &quot;Summarize this weather&quot;"\]/,
	);
	assert.match(output, /fetch -->\|stdin\| confirm/);
	assert.match(output, /fetch -->\|stdin\| advice/);
	assert.match(
		output,
		/confirm -->\|when: \$confirm\.approved &amp;&amp; \$fetch\.json\.temp &gt; 70\| advice/,
	);
});

test("workflow graph renderer contains Mermaid metacharacters in labels", () => {
	const output = renderWorkflowGraph({
		workflow: {
			steps: [{ id: "unsafe", run: 'echo \\"quoted" | next <tag>' }],
		},
		format: "mermaid",
	});

	assert.match(output, /echo \\&quot;quoted&quot; &#124; next &lt;tag&gt;/);
	assert.doesNotMatch(output, /"quoted"/);
});

test("workflow graph renderer outputs dot with approval shape", () => {
	const workflow = {
		steps: [
			{ id: "fetch", run: "echo hello" },
			{ id: "confirm", approval: "Proceed?", stdin: "$fetch.stdout" },
		],
	};

	const output = renderWorkflowGraph({ workflow, format: "dot" });
	assert.match(output, /^digraph workflow \{/m);
	assert.match(output, /"confirm" \[shape=diamond,label="confirm\\\\napproval gate"\];/);
	assert.match(output, /"fetch" -> "confirm" \[label="stdin"\];/);
});

test("cli graph defaults to mermaid and resolves --args-json values", async () => {
	const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lobster-graph-cli-"));
	const filePath = path.join(tmpDir, "workflow.lobster");
	const workflow = [
		"name: weather-check",
		"args:",
		"  city:",
		"    default: Phoenix",
		"steps:",
		"  - id: fetch",
		"    run: weather --json ${city}",
		"  - id: confirm",
		"    approval: Proceed?",
		"    stdin: $fetch.json",
	].join("\n");
	await fsp.writeFile(filePath, workflow, "utf8");

	const result = runCli(["graph", "--file", filePath, "--args-json", '{"city":"Seattle"}']);
	assert.equal(result.status, 0, `stderr=${result.stderr}`);
	assert.match(result.stdout, /^flowchart TD/m);
	assert.match(result.stdout, /run: weather --json Seattle/);
	assert.match(result.stdout, /confirm\{"confirm\\napproval gate"\}/);
});

test("cli graph supports --format dot", async () => {
	const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lobster-graph-dot-"));
	const filePath = path.join(tmpDir, "workflow.lobster");
	const workflow = [
		"steps:",
		"  - id: fetch",
		"    run: echo hello",
		"  - id: gate",
		"    approval: Proceed?",
		"    stdin: $fetch.stdout",
	].join("\n");
	await fsp.writeFile(filePath, workflow, "utf8");

	const result = runCli(["graph", "--file", filePath, "--format", "dot"]);
	assert.equal(result.status, 0, `stderr=${result.stderr}`);
	assert.match(result.stdout, /^digraph workflow \{/m);
	assert.match(result.stdout, /"gate" \[shape=diamond/);
});

test("JSON graph preserves native nodes and edges without executing the workflow", async (t) => {
	const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lobster-graph-json-"));
	t.after(() => fsp.rm(tmpDir, { recursive: true, force: true }));
	const filePath = path.join(tmpDir, "workflow.json");
	const marker = path.join(tmpDir, "executed");
	const workflow: WorkflowFile = {
		args: { message: { default: "<ready> & done | next" } },
		steps: [
			{ id: "fetch-items", run: 'touch "$MARKER"' },
			{ id: "filter", pipeline: "head --n 1 | json", stdin: "$fetch-items.json" },
			{ id: "loop", for_each: "$filter.json", steps: [{ id: "child", run: "echo item" }] },
			{
				id: "parallel",
				parallel: {
					branches: [
						{ id: "branch", run: "echo branch" },
						{ id: "second", pipeline: "head --n 1", stdin: "$fetch-items.json" },
					],
				},
			},
			{ id: "gate", approval: "Proceed?", stdin: "$fetch-items.stdout" },
			{
				id: "notify.items",
				run: 'echo "${message}"',
				when: "$gate.approved && $filter.json.length > 0",
			},
		],
	};
	const expected: WorkflowGraph = {
		nodes: [
			{ id: "fetch-items", type: "run", label: 'fetch-items\\nrun: touch "$MARKER"', shape: "box" },
			{
				id: "filter",
				type: "pipeline",
				label: "filter\\npipeline: head --n 1 | json",
				shape: "box",
			},
			{ id: "loop", type: "for_each", label: "loop\\nfor_each: $filter.json", shape: "box" },
			{ id: "parallel", type: "parallel", label: "parallel\\nparallel (all)", shape: "box" },
			{ id: "gate", type: "approval", label: "gate\\napproval gate", shape: "diamond" },
			{
				id: "notify.items",
				type: "run",
				label: 'notify.items\\nrun: echo "<ready> & done | next"',
				shape: "box",
			},
		],
		edges: [
			{ from: "fetch-items", to: "filter", label: "next" },
			{ from: "fetch-items", to: "filter", label: "stdin" },
			{ from: "filter", to: "loop", label: "next" },
			{ from: "filter", to: "loop", label: "for_each" },
			{ from: "loop", to: "parallel", label: "next" },
			{ from: "parallel", to: "gate", label: "next" },
			{ from: "fetch-items", to: "gate", label: "stdin" },
			{ from: "gate", to: "notify.items", label: "next" },
			{
				from: "gate",
				to: "notify.items",
				label: "when: $gate.approved && $filter.json.length > 0",
			},
			{
				from: "filter",
				to: "notify.items",
				label: "when: $gate.approved && $filter.json.length > 0",
			},
		],
	};
	const args = resolveWorkflowArgs(workflow.args, {});
	assert.deepEqual(JSON.parse(renderWorkflowGraph({ workflow, format: "json", args })), expected);
	await fsp.writeFile(filePath, JSON.stringify(workflow), "utf8");
	const result = runCli(["graph", "--file", filePath, "--format", "json"], { MARKER: marker });
	assert.equal(result.status, 0, `stderr=${result.stderr}`);
	assert.deepEqual(JSON.parse(result.stdout), expected);
	await assert.rejects(fsp.access(marker), { code: "ENOENT" });
});

test("cli graph rejects unsupported formats", async () => {
	const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lobster-graph-bad-format-"));
	const filePath = path.join(tmpDir, "workflow.lobster");
	await fsp.writeFile(filePath, "steps:\n  - id: s\n    run: echo ok\n", "utf8");

	const result = runCli(["graph", "--file", filePath, "--format", "svg"]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /graph --format must be one of: mermaid, dot, ascii, json/);
});
