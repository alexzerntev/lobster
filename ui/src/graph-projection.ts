import { extractStepRefs, graphStepType } from "../../src/workflows/graph-model.js";
import type { WorkflowGraph } from "../../src/workflows/graph-types.js";
import { getStepExecution } from "../../src/workflows/step.js";
import type { ParallelBranch, ParallelConfig, WorkflowStep } from "../../src/workflows/types.js";
import type { LobsterWorkflowDetail } from "../workflow-types.js";
import { WorkflowViewError } from "./workflow-errors.js";
import { workflowField as field, workflowFields, type WorkflowFields } from "./workflow-fields.js";

export type ProjectedNode = Omit<WorkflowGraph["nodes"][number], "type"> & {
	type: WorkflowGraph["nodes"][number]["type"] | "join";
	parentId?: string;
	isContainer?: boolean;
	title?: string;
	fields: WorkflowFields;
};
type Branch = { id: string; type: "run" | "pipeline"; value: ParallelBranch };
type LoopStep = {
	id: string;
	title: string;
	type: "run" | "pipeline" | "step";
	value: WorkflowStep;
};
type Parallel = {
	value: ParallelConfig;
	wait: "all" | "any";
	branches: Branch[];
	joinId: string;
};

function hasStringCommands(step: WorkflowStep): boolean {
	return [step.run, step.command, step.pipeline].every(
		(value) => value === undefined || typeof value === "string",
	);
}

function parallelMetadata(
	nodeId: string,
	step: WorkflowStep | undefined,
): Omit<Parallel, "joinId"> | undefined {
	const value = step?.parallel;
	if (value === undefined) return undefined;
	try {
		if (
			!Array.isArray(value.branches) ||
			value.branches.length === 0 ||
			value.branches.length > 500
		) {
			throw new Error("Invalid branches");
		}
		const wait = value.wait === undefined ? "all" : value.wait;
		if (wait !== "all" && wait !== "any") throw new Error("Invalid wait mode");
		const branches = value.branches.map((branch): Branch => {
			if (!branch || typeof branch.id !== "string" || !branch.id || !hasStringCommands(branch))
				throw new Error("Invalid branch definition");
			// A whitespace-only pipeline is loader-admitted; keep its declared display kind.
			const type = branch.pipeline ? "pipeline" : graphStepType(branch);
			if (type !== "run" && type !== "pipeline") throw new Error("Invalid branch execution");
			return { id: branch.id, type, value: branch };
		});
		return { value, wait, branches };
	} catch {
		throw new WorkflowViewError(
			`Cannot visualize parallel step "${nodeId}". Its branch definitions must contain unique ids and a command or pipeline.`,
		);
	}
}

function loopMetadata(nodeId: string, step: WorkflowStep | undefined): LoopStep[] | undefined {
	const value = step?.steps;
	if (value === undefined) return undefined;
	try {
		if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid loop steps");
		const ids = new Set<string>();
		return value.map((child): LoopStep => {
			if (
				!child ||
				typeof child.id !== "string" ||
				!child.id ||
				ids.has(child.id) ||
				!hasStringCommands(child)
			) {
				throw new Error("Invalid loop step id");
			}
			ids.add(child.id);
			const execution = getStepExecution(child);
			const type =
				execution.kind === "shell" ? "run" : execution.kind === "pipeline" ? "pipeline" : "step";
			return { id: child.id, title: child.id, type, value: child };
		});
	} catch {
		throw new WorkflowViewError(
			`Cannot visualize loop step "${nodeId}". Its steps must be an array of objects with unique ids and string command fields.`,
		);
	}
}

/** A view-only expansion. Lobster's saved definition and exported graph remain unchanged. */
export function projectWorkflowGraph(workflow: LobsterWorkflowDetail): {
	nodes: ProjectedNode[];
	edges: WorkflowGraph["edges"];
} {
	const native = workflow.graph ?? { nodes: [], edges: [] };
	const metadata = new Map((workflow.steps ?? []).map((step) => [step.id, step]));
	const usedIds = new Set(native.nodes.map((node) => node.id));
	const branches = new Set<string>();
	const parallel = new Map<string, Parallel>();
	const loops = new Map<string, LoopStep[]>();
	const uniqueId = (base: string) => {
		let candidate = base;
		let suffix = 2;
		while (usedIds.has(candidate)) {
			candidate = `${base}:${suffix++}`;
		}
		usedIds.add(candidate);
		return candidate;
	};
	// Reserve every real id first, including branches in later parallel steps.
	for (const node of native.nodes) {
		if (node.type !== "parallel") {
			continue;
		}
		const projected = parallelMetadata(node.id, metadata.get(node.id));
		if (!projected) continue;
		for (const branch of projected.branches) {
			if (usedIds.has(branch.id)) {
				throw new WorkflowViewError(
					`Cannot visualize parallel step "${node.id}". Branch id "${branch.id}" is already in use.`,
				);
			}
			usedIds.add(branch.id);
			branches.add(branch.id);
		}
		parallel.set(node.id, { ...projected, joinId: "" });
	}
	for (const [id, group] of parallel) {
		group.joinId = uniqueId(`${id}::join`);
	}
	for (const node of native.nodes) {
		if (node.type === "for_each") {
			const steps = loopMetadata(node.id, metadata.get(node.id));
			if (steps) {
				for (const step of steps) {
					step.id = uniqueId(`${node.id}::step:${step.id}`);
				}
				loops.set(node.id, steps);
			}
		}
	}
	const edges: WorkflowGraph["edges"] = [];
	const edgeKeys = new Set<string>();
	const addEdge = (edge: WorkflowGraph["edges"][number]) => {
		const key = JSON.stringify([edge.from, edge.to, edge.label]);
		if (!edgeKeys.has(key)) {
			edgeKeys.add(key);
			edges.push(edge);
		}
	};
	for (const edge of native.edges) {
		addEdge({ ...edge, from: parallel.get(edge.from)?.joinId ?? edge.from });
	}
	const addReferences = (value: unknown, to: string, label: string, branchOnly = false) => {
		for (const ref of extractStepRefs(value)) {
			if (branchOnly ? branches.has(ref) : usedIds.has(ref)) {
				addEdge({ from: parallel.get(ref)?.joinId ?? ref, to, label });
			}
		}
	};
	const nodes: ProjectedNode[] = [];
	for (const node of native.nodes) {
		const step = metadata.get(node.id);
		const fields = step ? workflowFields(step) : [];
		const group = parallel.get(node.id);
		const loop = loops.get(node.id);
		if (group) {
			nodes.push({
				...node,
				shape: "box",
				fields: fields
					.filter((entry) => entry.name !== "approval")
					.map((entry) =>
						entry.name === "parallel"
							? field(
									"parallel",
									Object.fromEntries(
										Object.entries(group.value).filter(([name]) => name !== "branches"),
									),
								)
							: entry,
					),
			});
			for (const branch of group.branches) {
				nodes.push({
					id: branch.id,
					type: branch.type,
					label: branch.id,
					shape: "box",
					parentId: node.id,
					fields: workflowFields(branch.value),
				});
				addEdge({ from: node.id, to: branch.id, label: "branch" });
				addReferences(branch.value.stdin, branch.id, "stdin");
				addEdge({ from: branch.id, to: group.joinId, label: group.wait });
			}
			nodes.push({
				id: group.joinId,
				type: "join",
				label: `Wait for ${group.wait}\n${node.id}`,
				shape: node.shape,
				parentId: node.id,
				fields: [
					field("wait", group.wait),
					field("parallel", node.id),
					...fields.filter((entry) => entry.name === "approval"),
				],
			});
		} else if (loop) {
			nodes.push({
				...node,
				isContainer: true,
				fields: fields.filter((entry) => entry.name !== "steps"),
			});
			for (const [index, step] of loop.entries()) {
				nodes.push({
					id: step.id,
					title: step.title,
					type: step.type,
					label: step.title,
					shape: "box",
					parentId: node.id,
					fields: workflowFields(step.value),
				});
				const next = loop[index + 1] ?? loop[0]!;
				addEdge({
					from: step.id,
					to: next.id,
					label: index + 1 < loop.length ? "next step" : "next item",
				});
			}
		} else {
			nodes.push({ ...node, fields });
		}
		// The native graph knows only top-level ids. Complete dependencies on visual
		// branch results without treating loop-local results as top-level outputs.
		for (const name of ["stdin", "for_each"] as const) {
			addReferences(step?.[name], node.id, name, true);
		}
		const value = step?.when ?? step?.condition;
		if (typeof value === "string" && value.trim()) {
			const label = `when: ${value.trim()}`;
			addReferences(value, node.id, label.length > 70 ? `${label.slice(0, 69)}…` : label, true);
		}
	}
	return { nodes, edges };
}
