import type { WorkflowGraph } from "../src/workflows/graph-types.js";
import type { WorkflowStep } from "../src/workflows/types.js";

export type LobsterWorkflowSummary = {
	id: string;
	name: string;
	description?: string;
	source: "file" | "builtin";
};

export type LobsterWorkflowStep = WorkflowStep;

export type LobsterWorkflowDetail = LobsterWorkflowSummary & {
	graph?: WorkflowGraph;
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
