import { parse as parseYaml } from "yaml";
import type { LobsterWorkflowDetail } from "../workflow-types.js";

const encoder = new TextEncoder();
const maxPathBytes = 2048;
const maxFieldBytes = 256 * 1024;
const redactionMarker = /\*{3}|…|\[redacted\]|<redacted>/iu;

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
		throw new Error(
			"Cannot locate this workflow's source directory. Open a workspace workflow file to inspect its sub-workflows.",
		);
	}
	const text = parent.steps
		?.find((step) => step.id === nodeId)
		?.fields.find((field) => field.name === "workflow")?.value;
	if (text === undefined) {
		throw new Error("This node has no sub-workflow path. Open Code to inspect its definition.");
	}
	if (text.length > maxFieldBytes || encoder.encode(text).length > maxFieldBytes) {
		throw new Error(
			"The sub-workflow field exceeds 256 KiB. Use a literal relative workflow path.",
		);
	}
	let target: unknown;
	try {
		target = parseYaml(text, { maxAliasCount: 0 });
	} catch {
		throw new Error(
			"The sub-workflow path is not a valid YAML string. Open Code and use a literal relative workflow path.",
		);
	}
	if (typeof target !== "string" || !target.trim()) {
		throw new Error("The sub-workflow path must be a nonempty string. Open Code to inspect it.");
	}
	if (redactionMarker.test(target) || redactionMarker.test(parentFilename)) {
		throw new Error(
			"The sub-workflow path is redacted and cannot be resolved. Inspect the original workflow file locally.",
		);
	}
	if (target.includes("$")) {
		throw new Error(
			"This sub-workflow path depends on runtime values. Open Code to inspect it; the viewer does not execute workflows.",
		);
	}
	if (target.startsWith("/") || hasUnsafeCharacter(target)) {
		throw new Error("Use a relative sub-workflow path inside workspace/workflows.");
	}
	const parts = parentFilename.split("/").slice(0, -1);
	for (const part of target.split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (parts.length === 0) {
				throw new Error(
					"The sub-workflow path leaves workspace/workflows. Move the file inside it.",
				);
			}
			parts.pop();
		} else {
			if (part.startsWith(".") || part === "node_modules") {
				throw new Error(
					"Move the sub-workflow outside hidden folders and node_modules to inspect it.",
				);
			}
			parts.push(part);
		}
	}
	const filename = parts.join("/");
	if (!workflowFilename(filename)) {
		throw new Error(
			"Use a .lobster, .yaml, .yml, or .json workflow path within 8 directory levels and 2048 UTF-8 bytes.",
		);
	}
	const encoded = btoa(String.fromCharCode(...encoder.encode(filename)))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
	return { id: `file:${encoded}`, filename };
}
