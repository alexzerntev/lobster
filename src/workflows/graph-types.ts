export type WorkflowGraphFormat = "mermaid" | "dot" | "ascii" | "json";

export const graphNodeTypes = [
	"run",
	"pipeline",
	"workflow",
	"approval",
	"input",
	"parallel",
	"for_each",
	"step",
] as const;

export type WorkflowGraphNodeType = (typeof graphNodeTypes)[number];

export type WorkflowGraphNode = {
	id: string;
	type: WorkflowGraphNodeType;
	label: string;
	shape: "box" | "diamond";
};

export type WorkflowGraphEdge = {
	from: string;
	to: string;
	label?: string;
};

export type WorkflowGraph = {
	nodes: WorkflowGraphNode[];
	edges: WorkflowGraphEdge[];
};
