import type { WorkflowGraph } from "../src/workflows/graph-types.js";

export type LobsterWorkflowSummary = {
	id: string;
	name: string;
	description?: string;
	source: "file" | "builtin";
};

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

// The engine owns graph structure. This boundary narrows its open node type to
// the kinds the viewer supports after the read API validates its output.
export type LobsterWorkflowGraph = Omit<WorkflowGraph, "nodes"> & {
	nodes: Array<
		Omit<WorkflowGraph["nodes"][number], "type"> & {
			type: (typeof graphNodeTypes)[number];
		}
	>;
};

export type LobsterWorkflowStep = {
	id: string;
	fields: Array<{ name: string; value: string; language?: "bash" }>;
};

export type LobsterWorkflowDetail = LobsterWorkflowSummary & {
	graph?: LobsterWorkflowGraph;
	steps?: LobsterWorkflowStep[];
	definition?: {
		filename: string;
		language: "yaml" | "json" | "javascript" | "typescript";
		text: string;
	};
	unavailableReason?: string;
};

export type LobsterWorkflowsResult = { workflows: LobsterWorkflowSummary[] };
export type LobsterWorkflowResult = { workflow: LobsterWorkflowDetail };

export type LobsterSourceLanguage =
	| "yaml"
	| "json"
	| "javascript"
	| "typescript"
	| "bash"
	| "python"
	| "plaintext";
export type LobsterSourceFile = { path: string; language: LobsterSourceLanguage };
export type LobsterWorkflowFilesResult = {
	files: LobsterSourceFile[];
	defaultPath: string;
	truncated: boolean;
};
export type LobsterWorkflowFileResult = {
	file: LobsterSourceFile & { text: string };
};
