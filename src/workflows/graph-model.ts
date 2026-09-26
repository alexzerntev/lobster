import type { WorkflowGraphNodeType } from "./graph-types.js";
import { isApprovalStep, isInputStep } from "./step.js";
import type { WorkflowStep } from "./types.js";

export function graphStepType(step: WorkflowStep): WorkflowGraphNodeType {
	if (step.parallel) return "parallel";
	if (typeof step.for_each === "string") return "for_each";
	if (typeof step.workflow === "string" && step.workflow.trim()) return "workflow";
	if (typeof step.pipeline === "string" && step.pipeline.trim()) return "pipeline";
	if (typeof step.run === "string" || typeof step.command === "string") return "run";
	if (isApprovalStep(step.approval)) return "approval";
	if (isInputStep(step.input)) return "input";
	return "step";
}

export function extractStepRefs(value: unknown): string[] {
	if (typeof value === "string") {
		const refs = new Set<string>();
		const rx = /\$([A-Za-z0-9_-]+)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*/g;
		for (const match of value.matchAll(rx)) {
			if (match[1]) refs.add(match[1]);
		}
		return [...refs];
	}
	if (Array.isArray(value)) {
		const refs = new Set<string>();
		for (const item of value) {
			for (const ref of extractStepRefs(item)) refs.add(ref);
		}
		return [...refs];
	}
	if (value && typeof value === "object") {
		const refs = new Set<string>();
		for (const entry of Object.values(value as Record<string, unknown>)) {
			for (const ref of extractStepRefs(entry)) refs.add(ref);
		}
		return [...refs];
	}
	return [];
}
