import { stringify as stringifyYaml } from "yaml";
import type { WorkflowStep } from "../../src/workflows/types.js";

export type WorkflowField = { name: string; value: string; language?: "bash" };
export type WorkflowFields = WorkflowField[];

function previewValue(name: string, value: unknown): unknown {
	if (typeof value === "string" && (name === "command" || name === "run")) {
		return value.replaceAll("\\n", "");
	}
	if (Array.isArray(value)) return value.map((item) => previewValue(name, item));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, previewValue(key, item)]),
		);
	}
	return value;
}

/** Preserve the compact card presentation without changing the workflow data. */
export function workflowField(name: string, value: unknown): WorkflowField {
	const projected = previewValue(name, value);
	if ((name === "command" || name === "run") && typeof projected === "string") {
		return { name, value: projected, language: "bash" };
	}
	return {
		name,
		value: stringifyYaml(projected, { lineWidth: 0 }).replace(/^([^\n]*)\n$/, "$1"),
	};
}

export function workflowFields(step: WorkflowStep): WorkflowFields {
	return Object.entries(step)
		.filter(([name]) => name !== "id")
		.map(([name, value]) => workflowField(name, value));
}
