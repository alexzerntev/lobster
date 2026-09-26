import { extractStepRefs } from "../../src/workflows/graph-model.js";
import type { LobsterWorkflowDetail } from "../workflow-types.js";
import { WorkflowViewError } from "./workflow-errors.js";

const encoder = new TextEncoder();
const maxPathBytes = 2048;
const maxFieldBytes = 256 * 1024;

export function isDynamicWorkflowPath(value: string): boolean {
	return /\$\{[A-Za-z0-9_-]+\}/u.test(value) || extractStepRefs(value).length > 0;
}

function hasUnsafeCharacter(value: string): boolean {
	return Array.from(value).some(
		(character) =>
			character === "\\" ||
			character === ":" ||
			character.charCodeAt(0) < 32 ||
			character.charCodeAt(0) === 127,
	);
}

function workflowFilename(filename: string): boolean {
	const parts = filename.split("/");
	const bytes = encoder.encode(filename);
	// These are the source catalog's portable path limits. The get RPC still owns
	// authoritative file access, including symlink, hardlink, and size checks.
	return (
		bytes.length <= maxPathBytes &&
		new TextDecoder().decode(bytes) === filename &&
		!hasUnsafeCharacter(filename) &&
		parts.length <= 9 &&
		parts.every((part) => part.length > 0 && !part.startsWith(".") && part !== "node_modules") &&
		/\.(?:lobster|ya?ml|json)$/iu.test(filename)
	);
}

export function subworkflowTarget(
	parent: LobsterWorkflowDetail,
	nodeId: string,
): { id: string; filename: string } {
	const parentFilename = parent.definition?.filename;
	if (parent.source !== "file" || !parentFilename || !workflowFilename(parentFilename)) {
		throw new WorkflowViewError(
			"Cannot locate this workflow's source directory. Open a workspace workflow file to inspect its sub-workflows.",
		);
	}
	const target = parent.steps?.find((step) => step.id === nodeId)?.workflow;
	if (target === undefined) {
		throw new WorkflowViewError(
			"This node has no sub-workflow path. Open Code to inspect its definition.",
		);
	}
	if (typeof target !== "string" || !target.trim()) {
		throw new WorkflowViewError(
			"The sub-workflow path must be a nonempty string. Open Code to inspect it.",
		);
	}
	if (target.length > maxFieldBytes || encoder.encode(target).length > maxFieldBytes) {
		throw new WorkflowViewError(
			"The sub-workflow field exceeds 256 KiB. Use a literal relative workflow path.",
		);
	}
	if (isDynamicWorkflowPath(target)) {
		throw new WorkflowViewError(
			"This sub-workflow path depends on runtime values. Open Code to inspect it; the viewer does not execute workflows.",
		);
	}
	if (target.startsWith("/") || hasUnsafeCharacter(target)) {
		throw new WorkflowViewError("Use a relative sub-workflow path inside workspace/workflows.");
	}
	const parts = parentFilename.split("/").slice(0, -1);
	for (const part of target.split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (parts.length === 0) {
				throw new WorkflowViewError(
					"The sub-workflow path leaves workspace/workflows. Move the file inside it.",
				);
			}
			parts.pop();
		} else {
			if (part.startsWith(".") || part === "node_modules") {
				throw new WorkflowViewError(
					"Move the sub-workflow outside hidden folders and node_modules to inspect it.",
				);
			}
			parts.push(part);
		}
	}
	const filename = parts.join("/");
	if (!workflowFilename(filename)) {
		throw new WorkflowViewError(
			"Use a .lobster, .yaml, .yml, or .json workflow path within 8 directory levels and 2048 UTF-8 bytes.",
		);
	}
	const encoded = btoa(String.fromCharCode(...encoder.encode(filename)))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
	return { id: `file:${encoded}`, filename };
}
