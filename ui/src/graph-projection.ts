import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
	LobsterWorkflowDetail,
	LobsterWorkflowGraph,
	LobsterWorkflowStep,
} from "../workflow-types.js";

export type ProjectedNode = Omit<LobsterWorkflowGraph["nodes"][number], "type"> & {
	type: LobsterWorkflowGraph["nodes"][number]["type"] | "join";
	parentId?: string;
	isContainer?: boolean;
	title?: string;
	fields: LobsterWorkflowStep["fields"];
};
type Branch = { id: string; type: "run" | "pipeline"; value: Record<string, unknown> };
type LoopStep = {
	id: string;
	title: string;
	type: "run" | "pipeline" | "step";
	value: Record<string, unknown>;
};
type Parallel = {
	value: Record<string, unknown>;
	wait: "all" | "any";
	branches: Branch[];
	joinId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseField(value: string): unknown {
	// The API already bounds and sanitizes fields. Alias expansion is unnecessary for
	// its serialized metadata and must not introduce cycles in the browser projection.
	return parseYaml(value, { maxAliasCount: 0 });
}

function field(name: string, value: unknown): LobsterWorkflowStep["fields"][number] {
	if ((name === "command" || name === "run") && typeof value === "string") {
		return { name, value, language: "bash" };
	}
	return { name, value: stringifyYaml(value, { lineWidth: 0 }).replace(/^([^\n]*)\n$/, "$1") };
}

function parallelMetadata(
	nodeId: string,
	fields: LobsterWorkflowStep["fields"],
): Omit<Parallel, "joinId"> {
	try {
		const text = fields.find((entry) => entry.name === "parallel")?.value;
		if (text === undefined) {
			throw new Error("Missing parallel definition");
		}
		const value = parseField(text);
		if (
			!isRecord(value) ||
			!Array.isArray(value.branches) ||
			value.branches.length === 0 ||
			value.branches.length > 500
		) {
			throw new Error("Invalid branches");
		}
		const wait = value.wait === undefined ? "all" : value.wait;
		if (wait !== "all" && wait !== "any") {
			throw new Error("Invalid wait mode");
		}
		const branches = value.branches.map((branch): Branch => {
			if (!isRecord(branch) || typeof branch.id !== "string" || !branch.id) {
				throw new Error("Missing branch id");
			}
			for (const name of ["run", "command", "pipeline"]) {
				if (branch[name] !== undefined && typeof branch[name] !== "string") {
					throw new Error("Invalid branch command");
				}
			}
			const shell = typeof branch.run === "string" ? branch.run : branch.command;
			const run = Boolean(shell);
			const pipeline = Boolean(branch.pipeline);
			if (Number(run) + Number(pipeline) !== 1) {
				throw new Error("Invalid branch execution");
			}
			return { id: branch.id, type: pipeline ? "pipeline" : "run", value: branch };
		});
		return { value, wait, branches };
	} catch {
		throw new Error(
			`Cannot visualize parallel step "${nodeId}". Its branch definitions must contain unique ids and a command or pipeline.`,
		);
	}
}

function loopMetadata(
	nodeId: string,
	fields: LobsterWorkflowStep["fields"],
): LoopStep[] | undefined {
	const text = fields.find((entry) => entry.name === "steps")?.value;
	if (text === undefined) {
		return undefined;
	}
	try {
		const value = parseField(text);
		if (!Array.isArray(value) || value.length > 500) {
			throw new Error("Invalid loop steps");
		}
		const ids = new Set<string>();
		return value.map((step): LoopStep => {
			if (!isRecord(step) || typeof step.id !== "string" || !step.id || ids.has(step.id)) {
				throw new Error("Invalid loop step id");
			}
			ids.add(step.id);
			for (const name of ["run", "command", "pipeline"]) {
				if (step[name] !== undefined && typeof step[name] !== "string") {
					throw new Error("Invalid loop command");
				}
			}
			// Match getStepExecution's precedence, but only shell and pipeline execute
			// inside a loop. Its other kinds produce a generic result, not nested graphs.
			let type: LoopStep["type"] = "step";
			if (
				!isRecord(step.parallel) &&
				!(typeof step.workflow === "string" && step.workflow.trim())
			) {
				const shell = typeof step.run === "string" ? step.run : step.command;
				if (typeof step.pipeline === "string" && step.pipeline.trim()) {
					type = "pipeline";
				} else if (typeof shell === "string" && shell.trim()) {
					type = "run";
				}
			}
			return { id: step.id, title: step.id, type, value: step };
		});
	} catch {
		throw new Error(
			`Cannot visualize loop step "${nodeId}". Its steps must be an array of objects with unique ids and string command fields.`,
		);
	}
}

function references(value: unknown): Set<string> {
	const found = new Set<string>();
	const visit = (entry: unknown) => {
		if (typeof entry === "string") {
			for (const match of entry.matchAll(
				/\$([A-Za-z0-9_-]+)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*/g,
			)) {
				found.add(match[1]!);
			}
		} else if (Array.isArray(entry)) {
			entry.forEach(visit);
		} else if (isRecord(entry)) {
			Object.values(entry).forEach(visit);
		}
	};
	visit(value);
	return found;
}

/** A view-only expansion. Lobster's saved definition and exported graph remain unchanged. */
export function projectWorkflowGraph(workflow: LobsterWorkflowDetail): {
	nodes: ProjectedNode[];
	edges: LobsterWorkflowGraph["edges"];
} {
	const native = workflow.graph ?? { nodes: [], edges: [] };
	const metadata = new Map((workflow.steps ?? []).map((step) => [step.id, step.fields]));
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
		const projected = parallelMetadata(node.id, metadata.get(node.id) ?? []);
		for (const branch of projected.branches) {
			if (usedIds.has(branch.id)) {
				throw new Error(
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
			const steps = loopMetadata(node.id, metadata.get(node.id) ?? []);
			if (steps) {
				for (const step of steps) {
					step.id = uniqueId(`${node.id}::step:${step.id}`);
				}
				loops.set(node.id, steps);
			}
		}
	}
	const edges: LobsterWorkflowGraph["edges"] = [];
	const edgeKeys = new Set<string>();
	const addEdge = (edge: LobsterWorkflowGraph["edges"][number]) => {
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
		for (const ref of references(value)) {
			if (branchOnly ? branches.has(ref) : usedIds.has(ref)) {
				addEdge({ from: parallel.get(ref)?.joinId ?? ref, to, label });
			}
		}
	};
	const nodes: ProjectedNode[] = [];
	for (const node of native.nodes) {
		const fields = metadata.get(node.id) ?? [];
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
					fields: Object.entries(branch.value)
						.filter(([name]) => name !== "id")
						.map(([name, value]) => field(name, value)),
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
					fields: Object.entries(step.value)
						.filter(([name]) => name !== "id")
						.map(([name, value]) => field(name, value)),
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
		for (const name of ["stdin", "for_each"]) {
			const value = fields.find((entry) => entry.name === name)?.value;
			if (value !== undefined) {
				addReferences(parseField(value), node.id, name, true);
			}
		}
		const when = fields.find((entry) => entry.name === "when");
		const condition = fields.find((entry) => entry.name === "condition");
		const value =
			(when ? parseField(when.value) : undefined) ??
			(condition ? parseField(condition.value) : undefined);
		if (typeof value === "string" && value.trim()) {
			const label = `when: ${value.trim()}`;
			addReferences(value, node.id, label.length > 70 ? `${label.slice(0, 69)}…` : label, true);
		}
	}
	return { nodes, edges };
}
