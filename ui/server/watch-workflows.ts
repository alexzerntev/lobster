import path from "node:path";
import { watch } from "chokidar";

/** One watcher per host lifetime, including creation/removal of the workflows directory. */
export function watchWorkflows(
	workspace: string,
	changed: () => void,
	failed: (error: unknown) => void,
) {
	let stopped = false;
	let pending: ReturnType<typeof setTimeout> | undefined;
	const root = path.join(workspace, "workflows");
	const watcher = watch(root, {
		ignoreInitial: true,
		followSymlinks: false,
		depth: 8,
		ignored: (filename) => {
			const relative = path.relative(root, filename);
			// Chokidar visits parents when the target does not exist yet. Do not ignore
			// those ancestors: they are how a later workflows/ creation is discovered.
			if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
				return false;
			return relative
				.split(path.sep)
				.some((part) => part.startsWith(".") || part === "node_modules");
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
