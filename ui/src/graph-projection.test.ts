import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../../src/workflows/types.js";
import type { LobsterWorkflowDetail } from "../workflow-types.js";
import { graphFor } from "./graph-layout.js";
import { projectWorkflowGraph } from "./graph-projection.js";

describe("parallel view projection", () => {
	it.each(["all", "any"] as const)(
		"projects %s branches without mutating native graph or raw steps",
		(wait) => {
			const workflow: LobsterWorkflowDetail = {
				id: "file:branches",
				name: "Branches",
				source: "file",
				steps: [
					{
						id: "fan",
						parallel: {
							wait,
							timeout_ms: 1000,
							branches: [
								{
									id: "left",
									run: "echo left\\n",
									stdin: { value: "$start.json" },
									env: { MODE: "fixture" },
								},
								{ id: "right", pipeline: "json", stdin: "$start.stdout" },
							],
						},
						approval: "Approve results?",
					},
					{
						id: "consumer",
						run: "cat",
						stdin: "$left.stdout",
						when: null,
						condition: "$left.json",
					},
					{
						id: "second",
						when: "",
						condition: "$right.json.ready",
						parallel: {
							branches: [{ id: "fan::join", command: "echo second", stdin: "$left.json" }],
						},
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

	it("retains native parallel nodes when expansion metadata is absent", () => {
		const graph = {
			nodes: [
				{ id: "group", type: "parallel", label: "group", shape: "diamond" },
				{ id: "after", type: "run", label: "after", shape: "box" },
			],
			edges: [{ from: "group", to: "after", label: "next" }],
		} satisfies NonNullable<LobsterWorkflowDetail["graph"]>;
		const visual = graphFor({ id: "file:native", name: "Native", source: "file", graph });
		expect(visual.nodes.map((node) => [node.id, node.data.type, node.data.shape])).toEqual([
			["group", "parallel", "diamond"],
			["after", "run", "box"],
		]);
		expect(visual.edges.map(({ source, target, label }) => [source, target, label])).toEqual([
			["group", "after", "next"],
		]);
	});

	it("keeps loader-admitted branch aliases and whitespace source kinds", () => {
		const steps: WorkflowStep[] = [
			{
				id: "group",
				parallel: {
					branches: [
						{ id: "alias", run: "echo selected", command: "echo ignored" },
						{ id: " ", command: " " },
						{ id: "pipe-space", pipeline: " " },
					],
				},
			},
		];
		const visual = graphFor({
			id: "file:aliases",
			name: "Aliases",
			source: "file",
			steps,
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
		null,
		{ branches: [] },
		{ branches: [null] },
		{ branches: [{ id: "child", run: 2 }] },
		{ wait: "later", branches: [{ id: "child", command: "echo hi" }] },
		{
			branches: [
				{ id: "same", command: "echo a" },
				{ id: "same", command: "echo b" },
			],
		},
		{ branches: [{ id: "group", command: "echo a" }] },
	])("rejects malformed structure or colliding ids at the viewer boundary", (parallel) => {
		expect(() =>
			graphFor({
				id: "file:invalid",
				name: "Invalid",
				source: "file",
				steps: [{ id: "group", parallel } as WorkflowStep],
				graph: {
					nodes: [{ id: "group", type: "parallel", label: "group", shape: "box" }],
					edges: [],
				},
			}),
		).toThrow(/Cannot visualize parallel step/);
	});
});

describe("loop view projection", () => {
	function loopWorkflow(steps?: WorkflowStep[]): LobsterWorkflowDetail {
		return {
			id: "file:loop",
			name: "Loop",
			source: "file",
			steps: [{ id: "loop", for_each: "$items.json", ...(steps === undefined ? {} : { steps }) }],
			graph: {
				nodes: [{ id: "loop", type: "for_each", label: "Loop items", shape: "box" }],
				edges: [],
			},
		};
	}

	it("contains the ordered body and return edge without mutating raw commands or colliding ids", () => {
		const workflow = loopWorkflow([
			{ id: "same", command: "printf hello\\n", env: { MODE: "test" } },
			{ id: "filter", pipeline: "json", stdin: "$same.stdout" },
			{ id: "last::join", run: "", command: "ignored" },
		]);
		workflow.steps!.push(
			{
				id: "loop::step:last",
				parallel: { branches: [{ id: "loop::step:same:2", command: "echo branch" }] },
			},
			{ id: "other", for_each: "$items.json", steps: [{ id: "same", command: "echo other" }] },
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
		[{ pipeline: "json" }, "pipeline"],
		[{ pipeline: " ", command: "echo chosen" }, "run"],
		[{ run: "", command: "echo ignored" }, "step"],
	] as const)(
		"uses the engine's execution kind for loader-admitted loop bodies",
		(fields, type) => {
			const workflow = loopWorkflow([{ id: "inner", ...fields }]);
			const visual = projectWorkflowGraph(workflow);
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
		expect(projectWorkflowGraph(loopWorkflow([]))).toEqual({
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
		null,
		{},
		[null],
		[{ command: "echo missing" }],
		[{ id: "", command: "echo empty" }],
		[{ id: "duplicate" }, { id: "duplicate" }],
		[{ id: "inner", run: null }],
		[{ id: "inner", command: {} }],
		[{ id: "inner", pipeline: 123 }],
		Array.from({ length: 501 }, (_, index) => ({ id: `step_${index}` })),
	])("rejects malformed loop structure at the viewer boundary", (steps) => {
		expect(() => projectWorkflowGraph(loopWorkflow(steps as WorkflowStep[]))).toThrow(
			/Cannot visualize loop step/,
		);
	});
});
