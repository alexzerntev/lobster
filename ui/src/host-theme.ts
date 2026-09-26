import type { LobsterHostTheme } from "./view-context.js";

/** Adapt a host's rendered theme once per embedding lifetime, shared by all its views. */
export function observeHostTheme(
	root: HTMLElement,
	signal: AbortSignal,
	/** Some hosts publish changes before their asynchronous palette stylesheet is ready. */
	subscribe?: (listener: () => void) => () => void,
): LobsterHostTheme {
	signal.throwIfAborted();
	const document = root.ownerDocument;
	const window = document.defaultView;
	if (!window) throw new Error("The viewer theme requires an attached host document.");
	const read = () => {
		const mode = window.getComputedStyle(root).colorScheme;
		if (mode !== "light" && mode !== "dark") {
			throw new Error("The viewer host must provide a resolved light or dark CSS color-scheme.");
		}
		return mode;
	};
	let mode = read();
	let disposed = false;
	const listeners = new Set<() => void>();
	const refresh = () => {
		if (disposed || signal.aborted) return;
		const next = read();
		if (mode === next) return;
		mode = next;
		for (const listener of listeners) {
			if (!signal.aborted) listener();
		}
	};
	const observer = new window.MutationObserver(refresh);
	observer.observe(root, {
		attributes: true,
		attributeFilter: ["class", "style", "data-theme", "data-theme-mode"],
	});
	// A loaded/replaced palette can change computed styles without changing root attributes.
	document.addEventListener("load", refresh, true);
	let stopHost: (() => void) | undefined;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		observer.disconnect();
		document.removeEventListener("load", refresh, true);
		signal.removeEventListener("abort", dispose);
		listeners.clear();
		stopHost?.();
	};
	signal.addEventListener("abort", dispose, { once: true });
	try {
		stopHost = subscribe?.(refresh);
		// A host may end its activation during subscribe(), before returning its disposer.
		if (disposed) stopHost?.();
		signal.throwIfAborted();
	} catch (error) {
		dispose();
		throw error;
	}
	return {
		get colorMode() {
			signal.throwIfAborted();
			return read();
		},
		subscribe(listener) {
			signal.throwIfAborted();
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
