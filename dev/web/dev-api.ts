import { constants } from "node:fs";
import { lstat, open, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveWorkflowArgs } from "../../src/workflows/file.js";
import { renderWorkflowGraph, type WorkflowGraph } from "../../src/workflows/graph.js";
import { validateWorkflowDocument } from "../../src/workflows/load.js";
import { listWorkflows } from "../../src/workflows/registry.js";

import type {
	LobsterWorkflowSummary as WorkflowSummary,
	LobsterWorkflowDetail as WorkflowDetail,
	LobsterSourceLanguage as SourceLanguage,
	LobsterWorkflowFilesResult as WorkflowFilesResult,
	LobsterWorkflowFileResult as WorkflowFileResult,
} from "@lobster/ui/workflow-types";
export type {
	LobsterWorkflowSummary as WorkflowSummary,
	LobsterWorkflowDetail as WorkflowDetail,
} from "@lobster/ui/workflow-types";

export class WorkflowApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
	) {
		super(message);
		this.name = "WorkflowApiError";
	}
}

const maxBytes = 256 * 1024;
const maxFiles = 100;
const maxEntries = 1000;
const maxDepth = 8;
const maxPathBytes = 2048;
const maxSteps = 500;
const extensions = new Set([".lobster", ".yaml", ".yml", ".json"]);
const sourceLanguages = new Map<string, SourceLanguage>([
	[".lobster", "yaml"],
	[".yaml", "yaml"],
	[".yml", "yaml"],
	[".json", "json"],
	[".js", "javascript"],
	[".mjs", "javascript"],
	[".cjs", "javascript"],
	[".jsx", "javascript"],
	[".ts", "typescript"],
	[".mts", "typescript"],
	[".cts", "typescript"],
	[".tsx", "typescript"],
	[".sh", "bash"],
	[".bash", "bash"],
	[".py", "python"],
	[".txt", "plaintext"],
	[".md", "plaintext"],
]);
const builtinPath = "src/workflows/github_pr_monitor.ts";

export function isWorkflowPath(filename: string): boolean {
	return extensions.has(path.extname(filename).toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
	return isRecord(error) && error.code === code;
}

function fileId(filename: string): string {
	return `file:${Buffer.from(filename).toString("base64url")}`;
}

function sourceLanguage(filename: string): SourceLanguage | undefined {
	return sourceLanguages.get(path.extname(filename).toLowerCase());
}

function isSourcePath(filename: string): boolean {
	const parts = filename.split("/");
	return (
		filename.length > 0 &&
		Buffer.byteLength(filename) <= maxPathBytes &&
		!/[\\\0:]/.test(filename) &&
		parts.length <= maxDepth + 1 &&
		parts.every((part) => Boolean(part) && !part.startsWith(".") && part !== "node_modules") &&
		sourceLanguage(filename) !== undefined
	);
}

function filenameFromId(id: string): string {
	if (!id.startsWith("file:") || id.length > 5 + Math.ceil((maxPathBytes * 4) / 3)) {
		throw new WorkflowApiError("Invalid workflow id", 400);
	}
	const filename = Buffer.from(id.slice(5), "base64url").toString("utf8");
	if (fileId(filename) !== id || !isSourcePath(filename) || !isWorkflowPath(filename)) {
		throw new WorkflowApiError("Invalid workflow id", 400);
	}
	return filename;
}

async function verifyDirectories(rootDir: string, filename = ""): Promise<string> {
	const workspace = await realpath(rootDir);
	let directory = workspace;
	const parts = ["workflows", ...filename.split("/").slice(0, -1)];
	for (const part of parts) {
		directory = path.join(directory, part);
		const stat = await lstat(directory);
		if (!stat.isDirectory() || stat.isSymbolicLink()) {
			throw new WorkflowApiError(
				"Workflow directories must be real directories without symlinks",
				400,
			);
		}
	}
	return path.join(workspace, "workflows");
}

async function readSource(workspaceDir: string, filename: string): Promise<string> {
	const rootDir = await verifyDirectories(workspaceDir, filename);
	const filePath = path.join(rootDir, filename);
	const handle = await open(
		filePath,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) {
			throw new WorkflowApiError(
				"Workflows must be regular files without hardlinks, no larger than 256 KiB",
				400,
			);
		}
		// Recheck the directory chain after opening, then read from the verified handle.
		// This also rejects a parent changed to a symlink during an editor's file replacement.
		const checkedRoot = await verifyDirectories(workspaceDir, filename);
		const canonical = await realpath(filePath);
		const current = await lstat(filePath);
		if (
			checkedRoot !== rootDir ||
			canonical !== filePath ||
			current.isSymbolicLink() ||
			current.dev !== stat.dev ||
			current.ino !== stat.ino
		) {
			throw new WorkflowApiError("Workflow path changed while reading; try again", 409);
		}
		const buffer = Buffer.alloc(maxBytes + 1);
		let size = 0;
		while (size < buffer.length) {
			const result = await handle.read(buffer, size, buffer.length - size, size);
			if (!result.bytesRead) break;
			size += result.bytesRead;
		}
		if (size > maxBytes) throw new WorkflowApiError("Workflow exceeds 256 KiB", 413);
		return buffer.subarray(0, size).toString("utf8");
	} finally {
		await handle.close();
	}
}

// Bound alias expansion and nested values before handing the document to the native
// validator/graph renderer. Syntax and workflow semantics remain Lobster-owned.
function checkDocumentBudget(document: unknown): void {
	const ancestors = new Set<object>();
	let values = 0;
	let bytes = 0;
	const visit = (value: unknown, depth: number): void => {
		if (++values > maxBytes / 4 || depth > 64) {
			throw new WorkflowApiError("Workflow exceeds the supported nesting or value limit", 400);
		}
		if (value === null || typeof value === "boolean" || typeof value === "number") return;
		if (typeof value === "string") {
			bytes += Buffer.byteLength(value);
			if (bytes > maxBytes) throw new WorkflowApiError("Expanded workflow exceeds 256 KiB", 413);
			return;
		}
		if (
			!Array.isArray(value) &&
			(!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype)
		) {
			throw new WorkflowApiError("Workflow fields must contain JSON-compatible values", 400);
		}
		if (ancestors.has(value))
			throw new WorkflowApiError("Workflow contains circular YAML aliases", 400);
		ancestors.add(value);
		for (const [key, entry] of Object.entries(value)) {
			visit(key, depth + 1);
			visit(entry, depth + 1);
		}
		ancestors.delete(value);
	};
	visit(document, 0);
	let steps = 0;
	const countSteps = (value: unknown): void => {
		if (!Array.isArray(value)) return;
		steps += value.length;
		if (steps > maxSteps) throw new WorkflowApiError("Workflow exceeds 500 steps", 400);
		for (const step of value) {
			if (!isRecord(step)) continue;
			countSteps(step.steps);
			if (isRecord(step.parallel)) countSteps(step.parallel.branches);
		}
	};
	if (isRecord(document)) countSteps(document.steps);
}

async function readDefinition(
	workspaceDir: string,
	filename: string,
): Promise<{
	workflow: WorkflowDetail;
	document?: unknown;
}> {
	const workflow: WorkflowDetail = {
		id: fileId(filename),
		name: path.basename(filename, path.extname(filename)),
		source: "file",
	};
	let source: string;
	try {
		source = await readSource(workspaceDir, filename);
	} catch (error) {
		if (hasCode(error, "ENOENT")) throw new WorkflowApiError("Workflow not found", 404);
		workflow.unavailableReason =
			error instanceof WorkflowApiError ? error.message : "Unable to read workflow";
		return { workflow };
	}
	const language = path.extname(filename).toLowerCase() === ".json" ? "json" : "yaml";
	workflow.definition = { filename, language, text: source };
	try {
		const document: unknown =
			language === "json" ? JSON.parse(source) : parseYaml(source, { maxAliasCount: 100 });
		checkDocumentBudget(document);
		if (isRecord(document)) {
			if (typeof document.name === "string" && document.name.trim())
				workflow.name = document.name.trim();
			if (typeof document.description === "string" && document.description.trim())
				workflow.description = document.description.trim();
		}
		return { workflow, document };
	} catch (error) {
		workflow.unavailableReason =
			error instanceof Error ? error.message : "Unable to parse workflow";
	}
	return { workflow };
}

async function readWorkflow(workspaceDir: string, filename: string): Promise<WorkflowDetail> {
	const { workflow, document } = await readDefinition(workspaceDir, filename);
	if (workflow.unavailableReason || document === undefined) return workflow;
	try {
		const loaded = validateWorkflowDocument(document);
		const graph = JSON.parse(
			renderWorkflowGraph({
				workflow: loaded,
				format: "json",
				args: resolveWorkflowArgs(loaded.args, {}),
			}),
		) as WorkflowGraph;
		if (Buffer.byteLength(JSON.stringify({ graph, steps: loaded.steps })) > maxBytes)
			throw new WorkflowApiError("Workflow graph exceeds 256 KiB", 413);
		workflow.graph = graph;
		workflow.steps = loaded.steps;
	} catch (error) {
		workflow.unavailableReason =
			error instanceof Error ? error.message : "Unable to parse workflow";
	}
	return workflow;
}

async function discoverFiles(
	workspaceDir: string,
	sources = false,
): Promise<{ files: string[]; truncated: boolean }> {
	let rootDir: string;
	try {
		rootDir = await verifyDirectories(workspaceDir);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return { files: [], truncated: false };
		throw error;
	}
	const files: string[] = [];
	let entries = 0;
	let truncated = false;
	const walk = async (relative: string, depth: number): Promise<void> => {
		await verifyDirectories(workspaceDir, path.posix.join(relative, "entry"));
		for await (const entry of await opendir(path.join(rootDir, relative))) {
			if (++entries > maxEntries) {
				if (!sources)
					throw new WorkflowApiError("The workflows directory exceeds 1000 entries", 400);
				truncated = true;
				return;
			}
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const filename = path.posix.join(relative, entry.name);
			if (entry.isDirectory()) {
				if (depth >= maxDepth) truncated = true;
				else await walk(filename, depth + 1);
			} else if (
				entry.isFile() &&
				isSourcePath(filename) &&
				(sources ? sourceLanguage(filename) : isWorkflowPath(filename))
			) {
				if (sources) {
					const stat = await lstat(path.join(rootDir, filename));
					if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) continue;
				}
				if (files.length === maxFiles) {
					if (!sources)
						throw new WorkflowApiError("The workflows directory exceeds 100 workflow files", 400);
					truncated = true;
					return;
				}
				files.push(filename);
			}
			if (entries > maxEntries || (truncated && files.length === maxFiles)) return;
		}
	};
	await walk("", 0);
	return { files: files.sort(), truncated };
}

export function createWorkflowApi(workspaceDir: string) {
	const builtins: WorkflowSummary[] = listWorkflows().map(({ name, description }) => ({
		id: `builtin:${name}`,
		name,
		description,
		source: "builtin",
	}));
	const findBuiltin = (id: string) => {
		const builtin = builtins.find((entry) => entry.id === id);
		if (!builtin || !["github.pr.monitor", "github.pr.monitor.notify"].includes(builtin.name))
			throw new WorkflowApiError("Workflow not found", 404);
		return builtin;
	};
	const readBuiltin = () => readFile(new URL(`../../${builtinPath}`, import.meta.url), "utf8");
	const verifyWorkflow = async (id: string): Promise<string> => {
		const filename = filenameFromId(id);
		try {
			await readSource(workspaceDir, filename);
		} catch (error) {
			if (hasCode(error, "ENOENT")) throw new WorkflowApiError("Workflow not found", 404);
			throw error;
		}
		return filename;
	};
	return {
		async list(): Promise<{ workflows: WorkflowSummary[] }> {
			const workflows = [...builtins];
			for (const filename of (await discoverFiles(workspaceDir)).files) {
				try {
					const {
						workflow: { id, name, description, source },
					} = await readDefinition(workspaceDir, filename);
					workflows.push({ id, name, ...(description ? { description } : {}), source });
				} catch (error) {
					if (!(error instanceof WorkflowApiError && error.statusCode === 404)) throw error;
				}
			}
			return { workflows: workflows.sort((a, b) => a.name.localeCompare(b.name)) };
		},
		async get(id: string): Promise<{ workflow: WorkflowDetail }> {
			if (id.startsWith("builtin:")) {
				const builtin = findBuiltin(id);
				// Both built-ins are implemented by this module; never execute it to inspect it.
				const text = await readBuiltin();
				return {
					workflow: {
						...builtin,
						definition: {
							filename: builtinPath,
							language: "typescript",
							text,
						},
					},
				};
			}
			return { workflow: await readWorkflow(workspaceDir, filenameFromId(id)) };
		},
		async files(id: string): Promise<WorkflowFilesResult> {
			if (id.startsWith("builtin:")) {
				findBuiltin(id);
				return {
					files: [{ path: builtinPath, language: "typescript" }],
					defaultPath: builtinPath,
					truncated: false,
				};
			}
			const defaultPath = await verifyWorkflow(id);
			const discovered = await discoverFiles(workspaceDir, true);
			if (!discovered.files.includes(defaultPath)) {
				if (discovered.files.length === maxFiles) discovered.files.pop();
				discovered.files.push(defaultPath);
				discovered.files.sort();
			}
			return {
				files: discovered.files.map((filename) => ({
					path: filename,
					language: sourceLanguage(filename)!,
				})),
				defaultPath,
				truncated: discovered.truncated,
			};
		},
		async file(id: string, filename: string): Promise<WorkflowFileResult> {
			if (id.startsWith("builtin:")) {
				findBuiltin(id);
				if (filename !== builtinPath) throw new WorkflowApiError("Source file not found", 404);
				return { file: { path: builtinPath, language: "typescript", text: await readBuiltin() } };
			}
			await verifyWorkflow(id);
			if (!isSourcePath(filename)) throw new WorkflowApiError("Invalid source path", 400);
			try {
				return {
					file: {
						path: filename,
						language: sourceLanguage(filename)!,
						text: await readSource(workspaceDir, filename),
					},
				};
			} catch (error) {
				if (hasCode(error, "ENOENT")) throw new WorkflowApiError("Source file not found", 404);
				throw error;
			}
		},
	};
}
