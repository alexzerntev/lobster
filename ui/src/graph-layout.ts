import { Graph, layout } from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node, type Rect } from "@xyflow/react";
import type { LobsterWorkflowDetail, LobsterWorkflowStep } from "../workflow-types.js";
import { projectWorkflowGraph, type ProjectedNode } from "./graph-projection.js";

type LayoutPoint = { x: number; y: number };
type LayoutNode = {
	width: number;
	height: number;
	x?: number;
	y?: number;
};
type LayoutEdge = {
	width: number;
	height: number;
	labelpos: "c";
	weight: number;
	points?: LayoutPoint[];
	x?: number;
	y?: number;
};
type LayoutGraph = {
	rankdir: "LR" | "TB";
	align?: "UR";
	ranksep: number;
	nodesep: number;
	edgesep: number;
	marginx: number;
	marginy: number;
};

export type WorkflowNode = Node<
	Pick<ProjectedNode, "label" | "shape" | "parentId" | "title" | "isContainer"> & {
		type: ProjectedNode["type"] | "builtin";
		fields: LobsterWorkflowStep["fields"];
	},
	"lobster"
>;
export type WorkflowEdge = Edge<
	{
		layout?: {
			points: LayoutPoint[];
			labelPosition?: LayoutPoint;
		};
	},
	"lobster-native"
>;

export function layoutWorkflowGraph(
	nodes: WorkflowNode[],
	edges: WorkflowEdge[],
	labelSizes: ReadonlyMap<string, { width: number; height: number }>,
	containerHeaders: ReadonlyMap<string, { width: number; height: number }> = new Map(),
): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; bounds: Rect } {
	const containers = nodes.filter((node) => node.data.isContainer);
	if (containers.length === 0) {
		return layoutFlatWorkflowGraph(nodes, edges, labelSizes);
	}
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const innerLayouts = new Map<string, ReturnType<typeof layoutFlatWorkflowGraph>>();
	const dimensions = new Map<string, { width: number; height: number }>();
	const padding = 24;
	for (const container of containers) {
		const header = containerHeaders.get(container.id);
		if (
			!header ||
			!Number.isFinite(header.width) ||
			!Number.isFinite(header.height) ||
			header.width <= 0 ||
			header.height <= 0
		) {
			throw new Error("Loop headers must be measured before layout");
		}
		const children = nodes.filter((node) => node.parentId === container.id);
		const inner = layoutFlatWorkflowGraph(
			children,
			edges.filter(
				(edge) =>
					byId.get(edge.source)?.parentId === container.id &&
					byId.get(edge.target)?.parentId === container.id,
			),
			labelSizes,
			"TB",
		);
		const dx = padding - inner.bounds.x;
		const dy = header.height + padding - inner.bounds.y;
		innerLayouts.set(container.id, {
			...inner,
			nodes: inner.nodes.map((node) => ({
				...node,
				position: { x: node.position.x + dx, y: node.position.y + dy },
			})),
			edges: inner.edges.map((edge) => translateEdge(edge, dx, dy)),
		});
		dimensions.set(container.id, {
			width: Math.max(header.width, inner.bounds.width + 2 * padding),
			height: header.height + inner.bounds.height + (children.length ? 2 * padding : 0),
		});
	}
	const outerNodes: WorkflowNode[] = [];
	for (const node of nodes) {
		if (!node.parentId) {
			const size = dimensions.get(node.id);
			outerNodes.push(size ? { ...node, measured: size, style: { ...node.style, ...size } } : node);
		}
	}
	const outer = layoutFlatWorkflowGraph(
		outerNodes,
		edges.filter((edge) => !byId.get(edge.source)?.parentId && !byId.get(edge.target)?.parentId),
		labelSizes,
	);
	const placedNodes = new Map(outer.nodes.map((node) => [node.id, node]));
	const placedEdges = new Map(outer.edges.map((edge) => [edge.id, edge]));
	for (const [id, inner] of innerLayouts) {
		const position = placedNodes.get(id)!.position;
		inner.nodes.forEach((node) => placedNodes.set(node.id, node));
		inner.edges.forEach((edge) =>
			placedEdges.set(edge.id, translateEdge(edge, position.x, position.y)),
		);
	}
	if (placedNodes.size !== nodes.length || placedEdges.size !== edges.length) {
		throw new Error("Workflow contains an unsupported container connection");
	}
	return {
		nodes: nodes.map((node) => placedNodes.get(node.id)!),
		edges: edges.map((edge) => placedEdges.get(edge.id)!),
		bounds: outer.bounds,
	};
}

function translateEdge(edge: WorkflowEdge, dx: number, dy: number): WorkflowEdge {
	const routed = edge.data!.layout!;
	const translate = ({ x, y }: LayoutPoint) => ({ x: x + dx, y: y + dy });
	return {
		...edge,
		data: {
			...edge.data,
			layout: {
				points: routed.points.map(translate),
				...(routed.labelPosition ? { labelPosition: translate(routed.labelPosition) } : {}),
			},
		},
	};
}

function layoutFlatWorkflowGraph(
	nodes: WorkflowNode[],
	edges: WorkflowEdge[],
	labelSizes: ReadonlyMap<string, { width: number; height: number }>,
	direction: LayoutGraph["rankdir"] = "LR",
): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; bounds: Rect } {
	if (nodes.length === 0 && edges.length === 0) {
		return { nodes: [], edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
	}
	const graph = new Graph<LayoutGraph, LayoutNode, LayoutEdge>({
		directed: true,
		multigraph: true,
	});
	// Native ids are arbitrary strings; do not expose them to Dagre's internal key namespace.
	const layoutIds = new Map(nodes.map((node, index) => [node.id, `node-${index}`]));
	graph.setGraph({
		rankdir: direction,
		// Keep the body chain in one column while its return route runs beside it.
		...(direction === "TB" ? { align: "UR" as const } : {}),
		ranksep: 80,
		nodesep: 48,
		edgesep: 32,
		marginx: 24,
		marginy: 24,
	});
	for (const node of nodes) {
		const { width, height } = node.measured ?? {};
		if (
			!width ||
			!height ||
			width <= 0 ||
			height <= 0 ||
			!Number.isFinite(width) ||
			!Number.isFinite(height)
		) {
			throw new Error("Workflow nodes must be measured before layout");
		}
		graph.setNode(layoutIds.get(node.id)!, { width, height });
	}
	const layoutEdges = edges.map((edge, index) => {
		const source = layoutIds.get(edge.source);
		const target = layoutIds.get(edge.target);
		if (!source || !target) {
			throw new Error("Workflow edge references an unknown node");
		}
		const hasLabel = typeof edge.label === "string";
		const size = hasLabel ? labelSizes.get(edge.id) : undefined;
		if (
			hasLabel &&
			(!size ||
				size.width <= 0 ||
				size.height <= 0 ||
				!Number.isFinite(size.width) ||
				!Number.isFinite(size.height))
		) {
			throw new Error("Workflow edge labels must be measured before layout");
		}
		const key = { v: source, w: target, name: `edge-${index}` };
		graph.setEdge(key, {
			width: size?.width ?? 0,
			height: size?.height ?? 0,
			labelpos: "c",
			// The native next chain is the visual spine; dependency edges remain present and routed.
			weight: edge.label === "next" || edge.label === "next step" ? 10 : 1,
		});
		return key;
	});
	layout(graph);
	const placedNodes = nodes.map((node) => {
		const placed: LayoutNode = graph.node(layoutIds.get(node.id)!);
		if (
			placed?.x === undefined ||
			placed.y === undefined ||
			!Number.isFinite(placed.x) ||
			!Number.isFinite(placed.y)
		) {
			throw new Error("Workflow layout did not position every node");
		}
		return {
			...node,
			position: { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 },
		};
	});
	const placedEdges = edges.map((edge, index) => {
		const placed: LayoutEdge = graph.edge(layoutEdges[index]!);
		if (
			!placed.points ||
			placed.points.length < 2 ||
			placed.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
		) {
			throw new Error("Workflow layout did not route every edge");
		}
		if (
			typeof edge.label === "string" &&
			(placed.x === undefined ||
				placed.y === undefined ||
				!Number.isFinite(placed.x) ||
				!Number.isFinite(placed.y))
		) {
			throw new Error("Workflow layout did not position every edge label");
		}
		let points = placed.points.map(({ x, y }) => ({ x, y }));
		let labelPosition =
			placed.x !== undefined && placed.y !== undefined ? { x: placed.x, y: placed.y } : undefined;
		if (direction === "TB" && edge.label === "next item") {
			// Loop returns use a side lane; keep the gap between steps for forward execution.
			const source = graph.node(layoutIds.get(edge.source)!);
			const target = graph.node(layoutIds.get(edge.target)!);
			const self = edge.source === edge.target;
			const start = {
				x: source.x! + source.width / 2,
				y: source.y! + (self ? source.height / 4 : 0),
			};
			const end = {
				x: target.x! + target.width / 2,
				y: target.y! - (self ? target.height / 4 : 0),
			};
			const sideX =
				Math.max(...placedNodes.map((node) => node.position.x + node.measured!.width!)) +
				32 +
				labelSizes.get(edge.id)!.width / 2;
			points = [start, { x: sideX, y: start.y }, { x: sideX, y: end.y }, end];
			labelPosition = { x: sideX, y: (start.y + end.y) / 2 };
		}
		return {
			...edge,
			data: {
				...edge.data,
				layout: {
					points,
					...(labelPosition ? { labelPosition } : {}),
				},
			},
		};
	});
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const include = (x: number, y: number, width = 0, height = 0) => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + width);
		maxY = Math.max(maxY, y + height);
	};
	for (const node of placedNodes) {
		include(node.position.x, node.position.y, node.measured!.width!, node.measured!.height!);
	}
	for (const edge of placedEdges) {
		const { points, labelPosition } = edge.data.layout;
		for (const point of points) {
			include(point.x, point.y);
		}
		if (labelPosition && typeof edge.label === "string") {
			const size = labelSizes.get(edge.id)!;
			include(
				labelPosition.x - size.width / 2,
				labelPosition.y - size.height / 2,
				size.width,
				size.height,
			);
		}
	}
	return {
		nodes: placedNodes,
		edges: placedEdges,
		bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
	};
}

export function graphFor(workflow: LobsterWorkflowDetail): {
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
} {
	// Built-ins have no native step graph. Show the implementation as one opaque card.
	if (workflow.source === "builtin" && !workflow.graph) {
		const fields: LobsterWorkflowStep["fields"] = [];
		if (workflow.description) {
			fields.push({ name: "description", value: workflow.description });
		}
		if (workflow.definition) {
			fields.push({ name: "file", value: workflow.definition.filename });
		}
		const node: WorkflowNode = {
			id: workflow.name,
			type: "lobster",
			position: { x: 0, y: 0 },
			data: { type: "builtin", label: workflow.name, shape: "box", fields },
			ariaLabel: workflow.name,
		};
		return { nodes: [node], edges: [] };
	}
	const projection = projectWorkflowGraph(workflow);
	const containers = new Set(
		projection.nodes.filter((node) => node.isContainer).map((node) => node.id),
	);
	const nodes: WorkflowNode[] = projection.nodes.map((node) => {
		const label = node.label.replaceAll("\\n", "\n");
		return {
			id: node.id,
			type: "lobster",
			position: { x: 0, y: 0 },
			...(node.parentId && containers.has(node.parentId)
				? { parentId: node.parentId, extent: "parent" as const }
				: {}),
			data: {
				type: node.type,
				label,
				shape: node.shape,
				...(node.parentId ? { parentId: node.parentId } : {}),
				...(node.title ? { title: node.title } : {}),
				...(node.isContainer ? { isContainer: true } : {}),
				fields: node.fields,
			},
			ariaLabel: label,
		};
	});
	const edges: WorkflowEdge[] = projection.edges.map((edge, index) => {
		return {
			id: `native-${index}`,
			source: edge.from,
			target: edge.to,
			sourceHandle: "next",
			targetHandle: "previous",
			type: "lobster-native",
			label: edge.label,
			data: {},
			markerEnd: { type: MarkerType.ArrowClosed },
			ariaLabel: `${edge.from} to ${edge.to}${edge.label ? `: ${edge.label}` : ""}`,
		};
	});
	return { nodes, edges };
}
