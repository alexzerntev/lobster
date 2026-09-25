import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { LobsterWorkflowDetail } from "../workflow-types.js";
import { graphFor } from "./graph-layout.js";
import { projectWorkflowGraph } from "./graph-projection.js";

describe("parallel view projection", () => {
	it.each(["all", "any"])(
		"projects %s branches without mutating native graph or source fields",
		(wait) => {
			const workflow: LobsterWorkflowDetail = {
				id: "file:branches",
				name: "Branches",
				source: "file",
				steps: [
					{
						id: "fan",
						fields: [
							{
								name: "parallel",
								value: stringify({
									wait,
									timeout_ms: 1000,
									branches: [
										{
											id: "left",
											run: "echo left",
											stdin: { value: "$start.json" },
											env: { MODE: "fixture" },
										},
										{ id: "right", pipeline: "json", stdin: "$start.stdout" },
									],
								}),
							},
							{ name: "approval", value: "Approve results?" },
						],
					},
					{
						id: "consumer",
						fields: [
							{ name: "stdin", value: "$left.stdout" },
							{ name: "when", value: "null" },
							{ name: "condition", value: "$left.json" },
						],
					},
					{
						id: "second",
						fields: [
							{ name: "when", value: '""' },
							{ name: "condition", value: "$right.json.ready" },
							{
								name: "parallel",
								value: stringify({
									branches: [{ id: "fan::join", command: "echo second", stdin: "$left.json" }],
								}),
							},
						],
					},
				],
				graph: {
					nodes: [
						{ id: "start", type: "run", label: "start", shape: "box" },
						{ id: "fan", type: "parallel", label: "fan", shape: "diamond" },
						{ id: "consumer", type: "run", label: "consumer", shape: "box" },
						{ id: "second", type: "parallel", label: "second", shape: "box" },
						{ id: "fan::join:2", type: "run", label: "reserved", shape: "box" },
					],
					edges: [
						{ from: "start", to: "fan", label: "next" },
						{ from: "fan", to: "consumer", label: "next" },
						{ from: "consumer", to: "second", label: "next" },
						{ from: "fan", to: "second", label: "stdin" },
						{ from: "second", to: "fan::join:2", label: "next" },
					],
				},
			};
			const original = structuredClone(workflow);
			const visual = graphFor(workflow);
			expect(workflow).toEqual(original);
			const byId = new Map(visual.nodes.map((node) => [node.id, node]));
			expect(byId.size).toBe(visual.nodes.length);
			expect(byId.get("fan")?.data).toMatchObject({
				shape: "box",
				fields: [{ name: "parallel", value: `wait: ${wait}\ntimeout_ms: 1000\n` }],
			});
			expect(byId.get("fan::join:3")?.data).toMatchObject({
				type: "join",
				parentId: "fan",
				shape: "diamond",
				label: `Wait for ${wait}\nfan`,
				fields: [
					{ name: "wait", value: wait },
					{ name: "parallel", value: "fan" },
					{ name: "approval", value: "Approve results?" },
				],
			});
			expect(byId.get("left")?.data.fields).toContainEqual({
				name: "run",
				value: "echo left",
				language: "bash",
			});
			expect(byId.get("right")?.data.type).toBe("pipeline");
			const edges = visual.edges.map(({ source, target, label }) => [source, target, label]);
			expect(edges).toEqual(
				expect.arrayContaining([
					["fan", "left", "branch"],
					["fan", "right", "branch"],
					["left", "fan::join:3", wait],
					["right", "fan::join:3", wait],
					["fan::join:3", "consumer", "next"],
					["fan::join:3", "second", "stdin"],
					["start", "left", "stdin"],
					["start", "right", "stdin"],
					["left", "consumer", "stdin"],
					["left", "consumer", "when: $left.json"],
					["left", "fan::join", "stdin"],
				]),
			);
			expect(edges).not.toContainEqual(["right", "second", "when: $right.json.ready"]);
		},
	);

	it("matches the native loader's run alias precedence and whitespace validation", () => {
		const visual = graphFor({
			id: "file:aliases",
			name: "Aliases",
			source: "file",
			steps: [
				{
					id: "group",
					fields: [
						{
							name: "parallel",
							value: stringify({
								branches: [
									{ id: "alias", run: "echo selected", command: "echo ignored" },
									{ id: " ", command: " " },
									{ id: "pipe-space", pipeline: " " },
								],
							}),
						},
					],
				},
			],
			graph: {
				nodes: [{ id: "group", type: "parallel", label: "group", shape: "box" }],
				edges: [],
			},
		});
		expect(
			visual.nodes.filter((node) => node.data.parentId === "group").map((node) => node.data.type),
		).toEqual(["run", "run", "pipeline", "join"]);
		expect(visual.nodes.find((node) => node.id === "alias")?.data.fields).toEqual([
			{ name: "run", value: "echo selected", language: "bash" },
			{ name: "command", value: "echo ignored", language: "bash" },
		]);
	});

	it.each([
		"branches: [",
		"branches: []",
		"branches: &cycle [*cycle]",
		"wait: later\nbranches: [{id: child, command: echo hi}]",
		"wait: null\nbranches: [{id: child, command: echo hi}]",
		"branches: [{id: child, workflow: other.lobster}]",
		"branches: [{id: child, command: echo hi, pipeline: json}]",
		'branches: [{id: child, run: "", command: echo ignored}]',
		'branches: [{id: child, run: " ", pipeline: json}]',
		"branches: [{id: same, command: echo a}, {id: same, command: echo b}]",
		"branches: [{id: group, command: echo a}]",
	])(
		"rejects malformed or colliding branch definitions without returning a partial graph",
		(value) => {
			expect(() =>
				graphFor({
					id: "file:invalid",
					name: "Invalid",
					source: "file",
					steps: [{ id: "group", fields: [{ name: "parallel", value }] }],
					graph: {
						nodes: [{ id: "group", type: "parallel", label: "group", shape: "box" }],
						edges: [],
					},
				}),
			).toThrow(/Cannot visualize parallel step/);
		},
	);
});

describe("loop view projection", () => {
	function loopWorkflow(steps?: string): LobsterWorkflowDetail {
		return {
			id: "file:loop",
			name: "Loop",
			source: "file",
			steps: [
				{
					id: "loop",
					fields: [
						{ name: "for_each", value: "$items.json" },
						...(steps === undefined ? [] : [{ name: "steps", value: steps }]),
					],
				},
			],
			graph: {
				nodes: [{ id: "loop", type: "for_each", label: "Loop items", shape: "box" }],
				edges: [],
			},
		};
	}

	it("contains the ordered loop body and return edge without changing native inputs or colliding with other ids", () => {
		const workflow = loopWorkflow(
			stringify([
				{ id: "same", command: "printf hello", env: { MODE: "test" } },
				{ id: "filter", pipeline: "json", stdin: "$same.stdout" },
				{ id: "last::join", run: "", command: "ignored", approval: true },
			]),
		);
		workflow.steps!.push(
			{
				id: "loop::step:last",
				fields: [
					{
						name: "parallel",
						value: stringify({ branches: [{ id: "loop::step:same:2", command: "echo branch" }] }),
					},
				],
			},
			{
				id: "other",
				fields: [{ name: "steps", value: stringify([{ id: "same", command: "echo other" }]) }],
			},
		);
		workflow.graph!.nodes.push(
			{ id: "loop::step:same", type: "run", label: "Reserved", shape: "box" },
			{ id: "loop::step:last", type: "parallel", label: "Branches", shape: "box" },
			{ id: "other", type: "for_each", label: "Other loop", shape: "box" },
		);
		workflow.graph!.edges.push({ from: "loop", to: "loop::step:same", label: "next" });
		const original = structuredClone(workflow);
		const visual = projectWorkflowGraph(workflow);
		expect(workflow).toEqual(original);
		expect(new Set(visual.nodes.map((node) => node.id)).size).toBe(visual.nodes.length);
		expect(visual.nodes[0]).toMatchObject({
			id: "loop",
			isContainer: true,
			fields: [{ name: "for_each", value: "$items.json" }],
		});
		const children = visual.nodes.filter((node) => node.parentId === "loop");
		expect(children.map(({ id, title, type, shape }) => ({ id, title, type, shape }))).toEqual([
			{ id: "loop::step:same:3", title: "same", type: "run", shape: "box" },
			{ id: "loop::step:filter", title: "filter", type: "pipeline", shape: "box" },
			{ id: "loop::step:last::join:2", title: "last::join", type: "step", shape: "box" },
		]);
		expect(visual.nodes.slice(1, 4)).toEqual(children);
		expect(children[0]!.fields).toEqual([
			{ name: "command", value: "printf hello", language: "bash" },
			{ name: "env", value: "MODE: test" },
		]);
		expect(children[2]!.fields).toContainEqual({ name: "approval", value: "true" });
		expect(visual.edges).toEqual(
			expect.arrayContaining([
				{ from: "loop", to: "loop::step:same", label: "next" },
				{ from: children[0]!.id, to: children[1]!.id, label: "next step" },
				{ from: children[1]!.id, to: children[2]!.id, label: "next step" },
				{ from: children[2]!.id, to: children[0]!.id, label: "next item" },
			]),
		);
		const other = visual.nodes.find((node) => node.parentId === "other")!;
		expect(other).toMatchObject({ title: "same", type: "run" });
		expect(visual.edges).toContainEqual({ from: other.id, to: other.id, label: "next item" });
	});

	it.each([
		[{ run: "echo chosen", command: "echo ignored" }, "run"],
		[{ pipeline: "json", command: "echo ignored" }, "pipeline"],
		[{ pipeline: " ", command: "echo chosen" }, "run"],
		[{ run: "", command: "echo ignored" }, "step"],
		[{ workflow: "child.lobster", pipeline: "json" }, "step"],
		[{ parallel: { branches: [] }, command: "echo ignored" }, "step"],
		[{ for_each: "$items.json", steps: [{ id: "nested", command: "echo nested" }] }, "step"],
		[{ approval: true, input: { prompt: "Ignored" } }, "step"],
	])(
		"matches inner-loop execution precedence without inventing nested execution or approval",
		(fields, type) => {
			const visual = projectWorkflowGraph(loopWorkflow(stringify([{ id: "inner", ...fields }])));
			expect(visual.nodes[1]).toMatchObject({
				title: "inner",
				type,
				shape: "box",
				parentId: "loop",
			});
			expect(visual.nodes).toHaveLength(2);
		},
	);

	it("distinguishes an empty body from missing metadata without adding dangling edges", () => {
		expect(projectWorkflowGraph(loopWorkflow("[]"))).toEqual({
			nodes: [
				{
					id: "loop",
					type: "for_each",
					label: "Loop items",
					shape: "box",
					isContainer: true,
					fields: [{ name: "for_each", value: "$items.json" }],
				},
			],
			edges: [],
		});
		expect(projectWorkflowGraph(loopWorkflow()).nodes[0]).not.toHaveProperty("isContainer");
	});

	it.each([
		"[",
		"null",
		"{}",
		"[null]",
		"[{command: echo missing}]",
		"[{id: '', command: echo empty}]",
		"[{id: duplicate}, {id: duplicate}]",
		"[{id: inner, run: null}]",
		"[{id: inner, command: {invalid: true}}]",
		"[{id: inner, pipeline: 123}]",
		"&cycle [*cycle]",
		stringify(Array.from({ length: 501 }, (_, index) => ({ id: `step_${index}` }))),
	])("rejects malformed loop metadata rather than returning a partial graph", (value) => {
		expect(() => projectWorkflowGraph(loopWorkflow(value))).toThrow(/Cannot visualize loop step/);
	});
});
