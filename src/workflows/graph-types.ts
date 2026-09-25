export type WorkflowGraphFormat = "mermaid" | "dot" | "ascii" | "json";

export type WorkflowGraphNode = {
	id: string;
	type: string;
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
