import { describe, expect, it } from "vitest";
import { graphFor, layoutWorkflowGraph } from "./graph-layout.js";

describe("workflow graph topology", () => {
	it("expands parallel fields while preserving native dependencies and loops without body metadata", () => {
		const graph = graphFor({
			id: "file:example",
			name: "Example",
			source: "file",
			steps: [
				{ id: "finish", run: "echo done" },
				{
					id: "parallel",
					parallel: { branches: [{ id: "branch", pipeline: "head --n 1 | json" }] },
				},
				{ id: "loop", for_each: "$start.json" },
				{ id: "start", run: "echo start" },
			],
			graph: {
				nodes: [
					{ id: "start", type: "run", label: "start\\nrun: echo start", shape: "box" },
					{ id: "parallel", type: "parallel", label: "parallel\\nparallel (all)", shape: "box" },
					{ id: "loop", type: "for_each", label: "loop\\nfor_each: $start.json", shape: "box" },
					{ id: "finish", type: "run", label: "finish\\nrun: echo done", shape: "diamond" },
				],
				edges: [
					{ from: "start", to: "parallel", label: "next" },
					{ from: "start", to: "parallel", label: "stdin" },
					{ from: "parallel", to: "loop", label: "next" },
					{ from: "start", to: "loop", label: "for_each" },
					{ from: "loop", to: "finish", label: "next" },
					{ from: "start", to: "finish", label: "when: $start.json" },
				],
			},
		});
		expect(graph.nodes.map((node) => node.id)).toEqual([
			"start",
			"parallel",
			"branch",
			"parallel::join",
			"loop",
			"finish",
		]);
		expect(graph.edges.map(({ source, target, label }) => [source, target, label])).toEqual([
			["start", "parallel", "next"],
			["start", "parallel", "stdin"],
			["parallel::join", "loop", "next"],
			["start", "loop", "for_each"],
			["loop", "finish", "next"],
			["start", "finish", "when: $start.json"],
			["parallel", "branch", "branch"],
			["branch", "parallel::join", "all"],
		]);
		expect(graph.nodes[5]?.data.shape).toBe("diamond");
		expect(graph.nodes[2]?.data.parentId).toBe("parallel");
		expect(graph.nodes[3]?.data).toMatchObject({
			type: "join",
			label: "Wait for all\nparallel",
			parentId: "parallel",
		});
		// Visual ownership is metadata, not React Flow compound-node positioning.
		expect(graph.nodes.every((node) => node.parentId === undefined)).toBe(true);
	});

	it("does not fabricate a graph when only step metadata is available", () => {
		expect(
			graphFor({
				id: "file:example",
				name: "Example",
				source: "file",
				steps: [{ id: "step", run: "echo hello" }],
			}),
		).toEqual({ nodes: [], edges: [] });
	});

	it.each([0, 1, 2, 3])(
		"stacks %i loop steps vertically with their return route inside the outer sequence",
		(count) => {
			const graph = graphFor({
				id: "file:loop",
				name: "Loop",
				source: "file",
				graph: {
					nodes: [
						{ id: "before", type: "run", label: "before", shape: "box" },
						{ id: "each", type: "for_each", label: "each", shape: "box" },
						{ id: "after", type: "run", label: "after", shape: "box" },
					],
					edges: [
						{ from: "before", to: "each", label: "next" },
						{ from: "each", to: "after", label: "next" },
					],
				},
				steps: [
					{
						id: "each",
						steps: Array.from({ length: count }, (_, i) => ({
							id: `body${i}`,
							command: "echo item",
						})),
					},
				],
			});
			const labels = new Map(graph.edges.map((edge) => [edge.id, { width: 90, height: 28 }]));
			const measured = graph.nodes.map((node, index) => ({
				...node,
				measured: { width: 340, height: 150 + index * 50 },
			}));
			const placed = layoutWorkflowGraph(
				measured,
				graph.edges,
				labels,
				new Map([["each", { width: 340, height: 180 }]]),
			);
			const parent = placed.nodes.find((node) => node.id === "each")!;
			const children = placed.nodes.filter((node) => node.parentId === "each");
			const before = placed.nodes.find((node) => node.id === "before")!;
			const after = placed.nodes.find((node) => node.id === "after")!;
			expect(children).toHaveLength(count);
			expect(parent.position.x).toBeGreaterThan(before.position.x + before.measured!.width!);
			expect(after.position.x).toBeGreaterThan(parent.position.x + parent.measured!.width!);
			const boxes = children.map((node) => ({
				id: node.id,
				x: parent.position.x + node.position.x,
				y: parent.position.y + node.position.y,
				width: node.measured!.width!,
				height: node.measured!.height!,
			}));
			const contained = (point: Point) => {
				expect(point.x).toBeGreaterThanOrEqual(parent.position.x);
				expect(point.x).toBeLessThanOrEqual(parent.position.x + parent.measured!.width!);
				expect(point.y).toBeGreaterThanOrEqual(parent.position.y + 180);
				expect(point.y).toBeLessThanOrEqual(parent.position.y + parent.measured!.height!);
			};
			for (const [index, child] of boxes.entries()) {
				contained(child);
				contained({ x: child.x + child.width, y: child.y + child.height });
				if (index > 0) {
					expect(child.x).toBe(boxes[index - 1]!.x);
					expect(child.y).toBeGreaterThan(boxes[index - 1]!.y + boxes[index - 1]!.height);
				}
			}
			const inner = placed.edges.filter((edge) => children.some((node) => node.id === edge.source));
			expect(inner.filter((edge) => edge.label === "next item")).toHaveLength(count ? 1 : 0);
			for (const edge of inner) {
				const route = edge.data!.layout!;
				route.points.forEach(contained);
				const size = labels.get(edge.id)!;
				const label = {
					x: route.labelPosition!.x - size.width / 2,
					y: route.labelPosition!.y - size.height / 2,
					...size,
				};
				contained(label);
				contained({ x: label.x + label.width, y: label.y + label.height });
				if (edge.label === "next item") {
					const source = boxes.find((card) => card.id === edge.source)!;
					const target = boxes.find((card) => card.id === edge.target)!;
					const start = route.points[0]!;
					const end = route.points.at(-1)!;
					expect(start.x).toBe(source.x + source.width);
					expect(end.x).toBe(target.x + target.width);
					expect(start.y).toBeGreaterThan(source.y);
					expect(start.y).toBeLessThan(source.y + source.height);
					expect(end.y).toBeGreaterThan(target.y);
					expect(end.y).toBeLessThan(target.y + target.height);
					expect(start.y).toBeGreaterThan(end.y);
					const right = Math.max(...boxes.map((card) => card.x + card.width));
					expect(label.x).toBeGreaterThan(right);
					route.points.slice(1, -1).forEach((point) => expect(point.x).toBeGreaterThan(right));
				}
				for (const card of boxes) {
					expect(
						label.x + label.width <= card.x ||
							card.x + card.width <= label.x ||
							label.y + label.height <= card.y ||
							card.y + card.height <= label.y,
					).toBe(true);
					if (card.id !== edge.source && card.id !== edge.target) {
						route.points
							.slice(1)
							.forEach((point, index) =>
								expect(segmentIntersectsBox(route.points[index]!, point, card)).toBe(false),
							);
					}
				}
			}
			// Remeasuring the resized parent must not grow it or move the graph again.
			expect(
				layoutWorkflowGraph(
					placed.nodes,
					graph.edges,
					labels,
					new Map([["each", { width: 340, height: 180 }]]),
				),
			).toEqual(placed);
		},
	);

	it("returns finite empty bounds when there is no graph", () => {
		expect(layoutWorkflowGraph([], [], new Map())).toEqual({
			nodes: [],
			edges: [],
			bounds: { x: 0, y: 0, width: 0, height: 0 },
		});
	});

	it("places measured parallel branches beside each other and joins them before continuing", () => {
		const graph = graphFor({
			id: "file:fork-join",
			name: "Fork and join",
			source: "file",
			steps: [
				{
					id: "group",
					parallel: {
						wait: "any",
						branches: [
							{ id: "left", command: "echo left" },
							{ id: "right", pipeline: "json" },
						],
					},
					approval: true,
				},
			],
			graph: {
				nodes: [
					{ id: "start", type: "run", label: "start", shape: "box" },
					{ id: "group", type: "parallel", label: "group", shape: "diamond" },
					{ id: "finish", type: "run", label: "finish", shape: "box" },
				],
				edges: [
					{ from: "start", to: "group", label: "next" },
					{ from: "group", to: "finish", label: "next" },
				],
			},
		});
		const heights = [180, 220, 450, 280, 260, 190];
		const labelSizes = new Map(graph.edges.map((edge) => [edge.id, { width: 86, height: 28 }]));
		const arranged = layoutWorkflowGraph(
			graph.nodes.map((node, index) => ({
				...node,
				measured: { width: 340, height: heights[index]! },
			})),
			graph.edges,
			labelSizes,
		);
		const cards = arranged.nodes.map((node) => ({
			id: node.id,
			x: node.position.x,
			y: node.position.y,
			width: node.measured!.width!,
			height: node.measured!.height!,
		}));
		const [start, group, left, right, join, finish] = cards;
		expect(group!.x).toBeGreaterThan(start!.x + start!.width);
		expect(left!.x).toBeGreaterThan(group!.x + group!.width);
		expect(left!.x).toBe(right!.x);
		expect(join!.x).toBeGreaterThan(left!.x + left!.width);
		expect(join!.x).toBeGreaterThan(right!.x + right!.width);
		expect(finish!.x).toBeGreaterThan(join!.x + join!.width);
		const labels = arranged.edges.map((edge) => {
			const point = edge.data!.layout!.labelPosition!;
			const size = labelSizes.get(edge.id)!;
			return { id: edge.id, x: point.x - size.width / 2, y: point.y - size.height / 2, ...size };
		});
		const boxes = [...cards, ...labels];
		for (const [index, box] of boxes.entries()) {
			for (const other of boxes.slice(index + 1)) {
				expect(
					box.x + box.width <= other.x ||
						other.x + other.width <= box.x ||
						box.y + box.height <= other.y ||
						other.y + other.height <= box.y,
					`${box.id} overlaps ${other.id}`,
				).toBe(true);
			}
		}
		for (const edge of arranged.edges) {
			const points = edge.data!.layout!.points;
			const obstacles = boxes.filter(
				(box) => box.id !== edge.source && box.id !== edge.target && box.id !== edge.id,
			);
			for (const [index, point] of points.slice(1).entries()) {
				for (const obstacle of obstacles) {
					expect(
						segmentIntersectsBox(points[index]!, point, obstacle),
						`${edge.id} crosses ${obstacle.id}`,
					).toBe(false);
				}
			}
		}
	});

	it("routes measured labels and parallel dependencies around cards in execution order", () => {
		const condition = 'when: $start.json.approved and $start.json.environment == "production"';
		const graph = graphFor({
			id: "file:measured",
			name: "Measured",
			source: "file",
			graph: {
				nodes: [
					{ id: "start", type: "run", label: "start", shape: "box" },
					{ id: "parallel", type: "pipeline", label: "parallel", shape: "box" },
					{ id: "each", type: "for_each", label: "each", shape: "box" },
					{ id: "finish", type: "run", label: "finish", shape: "diamond" },
				],
				edges: [
					{ from: "start", to: "parallel", label: "next" },
					{ from: "start", to: "parallel", label: "stdin" },
					{ from: "parallel", to: "each", label: "next" },
					{ from: "start", to: "each", label: "for_each" },
					{ from: "each", to: "finish", label: "next" },
					{ from: "start", to: "finish", label: condition },
					{ from: "each", to: "each", label: "stdin" },
				],
			},
		});
		const heights = [180, 410, 360, 220];
		const labelSizes = new Map(
			graph.edges.map((edge) => [
				edge.id,
				edge.label === condition ? { width: 180, height: 86 } : { width: 86, height: 28 },
			]),
		);
		const arranged = layoutWorkflowGraph(
			graph.nodes.map((node, index) => ({
				...node,
				measured: { width: 340, height: heights[index]! },
			})),
			graph.edges,
			labelSizes,
		);
		expect(arranged.edges.map(({ source, target, label }) => [source, target, label])).toEqual([
			["start", "parallel", "next"],
			["start", "parallel", "stdin"],
			["parallel", "each", "next"],
			["start", "each", "for_each"],
			["each", "finish", "next"],
			["start", "finish", condition],
			["each", "each", "stdin"],
		]);
		const cardBoxes = arranged.nodes.map((node) => ({
			id: `card:${node.id}`,
			x: node.position.x,
			y: node.position.y,
			width: node.measured!.width!,
			height: node.measured!.height!,
		}));
		const labelBoxes = arranged.edges.map((edge) => {
			const position = edge.data!.layout!.labelPosition!;
			const size = labelSizes.get(edge.id)!;
			return {
				id: `label:${edge.id}`,
				x: position.x - size.width / 2,
				y: position.y - size.height / 2,
				...size,
			};
		});
		const boxes = [...cardBoxes, ...labelBoxes];
		const { bounds } = arranged;
		const expectContained = ({ x, y }: Point) => {
			expect(x).toBeGreaterThanOrEqual(bounds.x);
			expect(y).toBeGreaterThanOrEqual(bounds.y);
			expect(x).toBeLessThanOrEqual(bounds.x + bounds.width);
			expect(y).toBeLessThanOrEqual(bounds.y + bounds.height);
		};
		for (const [index, box] of boxes.entries()) {
			expectContained(box);
			expectContained({ x: box.x + box.width, y: box.y + box.height });
			for (const other of boxes.slice(index + 1)) {
				const separated =
					box.x + box.width <= other.x ||
					other.x + other.width <= box.x ||
					box.y + box.height <= other.y ||
					other.y + other.height <= box.y;
				expect(separated, `${box.id} overlaps ${other.id}`).toBe(true);
			}
		}
		for (const edge of arranged.edges) {
			const points = edge.data!.layout!.points;
			expect(points.length).toBeGreaterThanOrEqual(2);
			points.forEach(expectContained);
			if (edge.label === "next") {
				const source = cardBoxes.find((box) => box.id === `card:${edge.source}`)!;
				const target = cardBoxes.find((box) => box.id === `card:${edge.target}`)!;
				expect(target.x).toBeGreaterThan(source.x + source.width);
			}
			const obstacles = boxes.filter(
				(box) =>
					box.id !== `card:${edge.source}` &&
					box.id !== `card:${edge.target}` &&
					box.id !== `label:${edge.id}`,
			);
			for (const [index, point] of points.slice(1).entries()) {
				for (const obstacle of obstacles) {
					expect(
						segmentIntersectsBox(points[index]!, point, obstacle),
						`${edge.source} → ${edge.target} crosses ${obstacle.id}`,
					).toBe(false);
				}
			}
		}
		expect(arranged.edges[0]!.data!.layout!.points).not.toEqual(
			arranged.edges[1]!.data!.layout!.points,
		);
	});
});

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

function segmentIntersectsBox(start: Point, end: Point, box: Box): boolean {
	// Intersect the segment's parameter interval with the rectangle's interior on both axes.
	let low = 0;
	let high = 1;
	for (const axis of ["x", "y"] as const) {
		const min = box[axis] + 0.001;
		const max = box[axis] + (axis === "x" ? box.width : box.height) - 0.001;
		const delta = end[axis] - start[axis];
		if (delta === 0) {
			if (start[axis] < min || start[axis] > max) {
				return false;
			}
		} else {
			const first = (min - start[axis]) / delta;
			const last = (max - start[axis]) / delta;
			low = Math.max(low, Math.min(first, last));
			high = Math.min(high, Math.max(first, last));
			if (low > high) {
				return false;
			}
		}
	}
	return true;
}
