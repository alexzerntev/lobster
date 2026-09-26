import type { WorkflowStep } from "./types.js";

export function isApprovalStep(approval: WorkflowStep["approval"]) {
	if (approval === true) return true;
	if (typeof approval === "string" && approval.trim().length > 0) return true;
	if (approval && typeof approval === "object" && !Array.isArray(approval)) return true;
	return false;
}

export function isInputStep(input: WorkflowStep["input"]) {
	return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

export function getStepExecution(step: WorkflowStep) {
	if (step.parallel && typeof step.parallel === "object" && !Array.isArray(step.parallel)) {
		return { kind: "parallel" as const, value: step.parallel };
	}

	if (typeof step.workflow === "string" && step.workflow.trim()) {
		return { kind: "workflow" as const, value: step.workflow };
	}

	if (typeof step.pipeline === "string" && step.pipeline.trim()) {
		return { kind: "pipeline" as const, value: step.pipeline };
	}

	const shellCommand = typeof step.run === "string" ? step.run : step.command;
	if (typeof shellCommand === "string" && shellCommand.trim()) {
		return { kind: "shell" as const, value: shellCommand };
	}

	return { kind: "none" as const };
}
