import type {
	LobsterSourceFile,
	LobsterWorkflowFileResult,
	LobsterWorkflowFilesResult,
} from "../workflow-types.js";
import { syntax } from "./syntax.js";
import type { LobsterViewContext } from "./view-context.js";

type Folder = { folders: Map<string, Folder>; files: LobsterSourceFile[] };

function icon(folder: boolean) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.5");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		folder
			? "M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"
			: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6",
	);
	svg.append(path);
	return svg;
}

/** Read-only source selection belongs to this view; the host owns filesystem access. */
export function createSourceExplorer({
	host,
	signal,
	onFilesChange,
}: Pick<LobsterViewContext, "host" | "signal"> & {
	onFilesChange: (files: readonly LobsterSourceFile[]) => void;
}) {
	const element = document.createElement("div");
	element.className = "lobster-graph__code-view";
	element.hidden = true;
	const sidebar = document.createElement("nav");
	sidebar.className = "lobster-source__sidebar";
	sidebar.setAttribute("aria-label", "Workflow files");
	const heading = document.createElement("div");
	heading.className = "lobster-source__heading";
	heading.textContent = "Files";
	const tree = document.createElement("div");
	tree.className = "lobster-source__tree";
	const notice = document.createElement("p");
	notice.className = "lobster-source__notice";
	notice.hidden = true;
	sidebar.append(heading, tree, notice);
	const editor = document.createElement("section");
	editor.className = "lobster-source__editor";
	editor.setAttribute("aria-label", "Source preview");
	const filename = document.createElement("div");
	filename.className = "lobster-source__filename";
	const status = document.createElement("p");
	status.className = "lobster-source__message";
	status.setAttribute("role", "status");
	status.tabIndex = -1;
	const pre = document.createElement("pre");
	pre.className = "lobster-graph__code";
	pre.tabIndex = 0;
	pre.setAttribute("aria-label", "Workflow source (read-only)");
	const code = document.createElement("code");
	pre.append(code);
	editor.append(filename, status, pre);
	element.append(sidebar, editor);

	let workflowId: string | undefined;
	let selectedPath: string | undefined;
	let files: LobsterSourceFile[] = [];
	let epoch = 0;
	let readEpoch = 0;
	let dirty = true;
	let readDirty = true;
	let loading = false;
	let disposed = false;
	const collapsed = new Set<string>();
	const current = (generation: number) => !disposed && !signal.aborted && generation === epoch;
	const message = (text: string, error = false) => {
		status.textContent = text;
		status.hidden = !text;
		status.setAttribute("role", error ? "alert" : "status");
	};
	const markSelection = () => {
		for (const button of tree.querySelectorAll<HTMLButtonElement>("button[data-path]")) {
			if (button.dataset.path === selectedPath) {
				button.setAttribute("aria-current", "true");
			} else {
				button.removeAttribute("aria-current");
			}
		}
	};
	const select = async (path: string, focus = false) => {
		if (!workflowId || !host.connection.connected) {
			return;
		}
		const generation = epoch;
		const read = ++readEpoch;
		readDirty = false;
		selectedPath = path;
		filename.textContent = path;
		filename.title = path;
		markSelection();
		code.textContent = "";
		pre.hidden = true;
		message("Loading file…");
		editor.setAttribute("aria-busy", "true");
		try {
			const result = await host.request<LobsterWorkflowFileResult>("lobster.workflows.file", {
				id: workflowId,
				path,
			});
			if (!current(generation) || read !== readEpoch) {
				return;
			}
			code.className = `language-${result.file.language}`;
			code.textContent = result.file.text;
			code.removeAttribute("data-highlighted");
			if (result.file.language !== "plaintext") {
				syntax.highlightElement(code);
			}
			pre.hidden = false;
			pre.scrollTop = 0;
			pre.scrollLeft = 0;
			message("");
			if (focus && !element.hidden) {
				pre.focus();
			}
		} catch (error) {
			if (!current(generation) || read !== readEpoch) {
				return;
			}
			message(
				`Could not read this file. ${host.redact(error instanceof Error ? error.message : String(error))} Select a file to try again.`,
				true,
			);
			if (focus && !element.hidden) {
				status.focus();
			}
		} finally {
			if (current(generation) && read === readEpoch) {
				editor.setAttribute("aria-busy", "false");
			}
		}
	};
	const renderTree = () => {
		const root: Folder = { folders: new Map(), files: [] };
		for (const file of files) {
			let parent = root;
			const parts = file.path.split("/");
			for (const name of parts.slice(0, -1)) {
				let child = parent.folders.get(name);
				if (!child) {
					child = { folders: new Map(), files: [] };
					parent.folders.set(name, child);
				}
				parent = child;
			}
			parent.files.push(file);
		}
		const list = (folder: Folder, prefix: string): HTMLUListElement => {
			const ul = document.createElement("ul");
			for (const [name, child] of [...folder.folders].toSorted(([a], [b]) => a.localeCompare(b))) {
				const path = `${prefix}${name}/`;
				const li = document.createElement("li");
				const details = document.createElement("details");
				details.open = !collapsed.has(path);
				const summary = document.createElement("summary");
				const label = document.createElement("span");
				label.textContent = name;
				summary.title = path;
				summary.append(icon(true), label);
				details.append(summary, list(child, path));
				details.addEventListener("toggle", () => {
					if (!details.isConnected) {
						return;
					}
					if (details.open) {
						collapsed.delete(path);
					} else {
						collapsed.add(path);
					}
				});
				li.append(details);
				ul.append(li);
			}
			for (const file of folder.files.toSorted((a, b) => a.path.localeCompare(b.path))) {
				const li = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.className = "lobster-source__file";
				button.dataset.path = file.path;
				button.title = file.path;
				button.setAttribute("aria-label", file.path);
				const label = document.createElement("span");
				label.textContent = file.path.split("/").at(-1) ?? file.path;
				button.append(icon(false), label);
				li.append(button);
				ul.append(li);
			}
			return ul;
		};
		tree.replaceChildren(list(root, ""));
		markSelection();
	};
	const load = async () => {
		if (!workflowId || loading || !dirty || !host.connection.connected) {
			return;
		}
		const generation = epoch;
		loading = true;
		tree.inert = true;
		sidebar.setAttribute("aria-busy", "true");
		message("Loading files…");
		try {
			const result = await host.request<LobsterWorkflowFilesResult>("lobster.workflows.files", {
				id: workflowId,
			});
			if (!current(generation)) {
				return;
			}
			if (
				!result ||
				!Array.isArray(result.files) ||
				result.files.some((file) => typeof file?.path !== "string")
			) {
				throw new Error("The source catalog returned an invalid file list");
			}
			dirty = false;
			files = result.files;
			onFilesChange(files);
			selectedPath ??= result.defaultPath;
			renderTree();
			notice.hidden = !result.truncated;
			notice.textContent = "Showing a limited file tree. Some files or folders were omitted.";
			if (files.some((file) => file.path === selectedPath)) {
				if (!element.hidden) {
					await select(selectedPath);
				}
			} else {
				filename.textContent = selectedPath;
				message(
					files.length
						? "This file is no longer available. Select another file."
						: "No source files are available.",
				);
			}
		} catch (error) {
			if (!current(generation)) {
				return;
			}
			tree.replaceChildren();
			message(
				`Could not load files. ${host.redact(error instanceof Error ? error.message : String(error))} Reopen Code to try again.`,
				true,
			);
		} finally {
			if (current(generation)) {
				loading = false;
				tree.inert = false;
				sidebar.setAttribute("aria-busy", "false");
			}
		}
	};
	const click = (event: MouseEvent) => {
		if (!(event.target instanceof Element)) {
			return;
		}
		const button = event.target.closest<HTMLButtonElement>("button[data-path]");
		if (button?.dataset.path && tree.contains(button)) {
			void select(button.dataset.path);
		}
	};
	tree.addEventListener("click", click);
	return {
		element,
		invalidate() {
			epoch += 1;
			readEpoch += 1;
			loading = false;
			dirty = true;
			readDirty = true;
			files = [];
			onFilesChange(files);
			code.textContent = "";
			pre.hidden = true;
			editor.setAttribute("aria-busy", "false");
		},
		setWorkflow(id: string) {
			if (workflowId !== id) {
				epoch += 1;
				workflowId = id;
				selectedPath = undefined;
				dirty = true;
				readDirty = true;
				collapsed.clear();
				files = [];
				onFilesChange(files);
				tree.replaceChildren();
				filename.textContent = "";
			}
		},
		prepare: load,
		open(path: string) {
			if (disposed || signal.aborted || !files.some((file) => file.path === path)) {
				return false;
			}
			const parts = path.split("/");
			for (let index = 1; index < parts.length; index += 1) {
				collapsed.delete(`${parts.slice(0, index).join("/")}/`);
			}
			renderTree();
			void select(path, true);
			return true;
		},
		show(visible: boolean) {
			element.hidden = !visible;
			if (visible) {
				if (dirty) {
					void load();
				} else if (readDirty && selectedPath && files.some((file) => file.path === selectedPath)) {
					void select(selectedPath);
				}
			}
		},
		dispose() {
			disposed = true;
			epoch += 1;
			tree.removeEventListener("click", click);
			element.remove();
		},
	};
}
