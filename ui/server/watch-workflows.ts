import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { watch } from "chokidar";

/** One watcher per host lifetime, including creation/removal of the workflows directory. */
export async function watchWorkflows(
	workspace: string,
	changed: () => void,
	failed: (error: unknown) => void,
) {
	let root: string;
	try {
		root = await realpath(workspace);
		if (!(await stat(root)).isDirectory()) throw new Error("Not a directory");
	} catch {
		throw new Error("Lobster viewer requires an existing, readable workspace directory.");
	}
	let stopped = false;
	let pending: ReturnType<typeof setTimeout> | undefined;
	// Start from the existing parent: Chokidar can signal ready before installing
	// its fallback watcher for a missing path. This also survives workflows/ replacement.
	const watcher = watch(root, {
		ignoreInitial: true,
		followSymlinks: false,
		depth: 9,
		ignored: (filename) => {
			const relative = path.relative(root, filename);
			if (!relative) return false;
			const parts = relative.split(path.sep);
			return (
				parts[0] !== "workflows" ||
				parts.some((part) => part.startsWith(".") || part === "node_modules")
			);
		},
	});
	let settled = false;
	let resolveReady: () => void;
	let rejectReady: (error: unknown) => void;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	watcher.once("ready", () => {
		settled = true;
		resolveReady();
	});
	watcher.on("all", () => {
		if (stopped) return;
		clearTimeout(pending);
		pending = setTimeout(() => {
			pending = undefined;
			if (!stopped) changed();
		}, 100);
		pending.unref();
	});
	watcher.on("error", (error) => {
		if (stopped) return;
		if (!settled) {
			settled = true;
			rejectReady(error);
		}
		failed(error);
	});
	return {
		ready,
		async close() {
			if (stopped) return;
			stopped = true;
			if (!settled) {
				settled = true;
				resolveReady();
			}
			clearTimeout(pending);
			await watcher.close();
		},
	};
}
