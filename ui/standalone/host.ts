import { WorkflowViewError, workflowErrorMessage } from "../src/workflow-errors.js";
import {
	type LobsterPageTarget,
	type LobsterHostTheme,
	type LobsterViewContext,
} from "@clawdbot/lobster-viewer";
import type {
	LobsterWorkflowFileResult,
	LobsterWorkflowFilesResult,
	LobsterWorkflowResult,
	LobsterWorkflowsResult,
} from "@clawdbot/lobster-viewer";
import { mountStandaloneDialog } from "./dialog.js";

type WorkflowTransport = {
	list: (signal: AbortSignal) => Promise<LobsterWorkflowsResult>;
	get: (id: string, signal: AbortSignal) => Promise<LobsterWorkflowResult>;
	files: (id: string, signal: AbortSignal) => Promise<LobsterWorkflowFilesResult>;
	file: (id: string, path: string, signal: AbortSignal) => Promise<LobsterWorkflowFileResult>;
};

const messages = {
	params: "Select a workflow or a source file from its tree.",
	page: "This page is not supported by the standalone viewer.",
	pageParams: "Invalid viewer page parameters. Select a workflow from the list.",
	disconnected: "The viewer server is disconnected. Check that it is running and retry.",
};

function hasKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return (
		(prototype === Object.prototype || prototype === null) &&
		Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.includes(key))
	);
}

function workflowId(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function pageHref(target: LobsterPageTarget): string {
	if (!hasKeys(target, ["id", "params"])) throw new WorkflowViewError(messages.pageParams);
	if (target.id === "workflows") {
		if (target.params !== undefined && !hasKeys(target.params, [])) {
			throw new WorkflowViewError(messages.pageParams);
		}
		return "/";
	}
	if (target.id !== "workflow") throw new WorkflowViewError(messages.page);
	if (!hasKeys(target.params, ["workflowId"]) || !workflowId(target.params.workflowId)) {
		throw new WorkflowViewError(messages.pageParams);
	}
	return `/workflow?id=${encodeURIComponent(target.params.workflowId)}`;
}

/** The server marks only known, sanitized workflow errors as safe to display. */
export async function readWorkflowResponse(url: string, signal: AbortSignal) {
	const response = await fetch(url, { signal, credentials: "omit" });
	const body = await response.json();
	if (!response.ok) {
		if (body?.error?.type === "workflow" && typeof body.error.message === "string") {
			throw new WorkflowViewError(body.error.message);
		}
		throw new Error("Workflow request failed");
	}
	return body;
}

/** Local reads, navigation, and view lifetimes; no workflow execution transport. */
export function createStandaloneHost({
	transport,
	navigate,
	theme,
}: {
	transport: WorkflowTransport;
	navigate: (href: string) => void;
	theme: LobsterHostTheme;
}) {
	let connected = false;
	const owner = new AbortController();
	const views = new Set<{
		notify: () => void;
		emitWorkflowsChanged: () => void;
		dispose: () => void;
	}>();
	const notify = () => {
		for (const view of views) view.notify();
	};
	return {
		createView(signal: AbortSignal): {
			host: LobsterViewContext["host"];
			dispose: () => void;
		} {
			owner.signal.throwIfAborted();
			signal.throwIfAborted();
			const lifetime = new AbortController();
			const listeners = new Set<() => void>();
			const events = new Set<() => void>();
			const themeSubscriptions = new Set<() => void>();
			const assertActive = () => lifetime.signal.throwIfAborted();
			const read = async <T>(operation: () => Promise<T>): Promise<T> => {
				assertActive();
				if (!connected) throw new WorkflowViewError(messages.disconnected);
				const result = await operation();
				assertActive();
				return result;
			};
			const assertId = (id: string) => {
				if (!workflowId(id)) throw new WorkflowViewError(messages.params);
			};
			const dispose = () => {
				if (lifetime.signal.aborted) return;
				lifetime.abort();
				for (const stop of themeSubscriptions) stop();
				themeSubscriptions.clear();
				listeners.clear();
				events.clear();
				signal.removeEventListener("abort", dispose);
				views.delete(view);
			};
			const view = {
				notify() {
					for (const listener of listeners) {
						if (!lifetime.signal.aborted) listener();
					}
				},
				emitWorkflowsChanged() {
					for (const listener of events) {
						if (!lifetime.signal.aborted) listener();
					}
				},
				dispose,
			};
			views.add(view);
			signal.addEventListener("abort", dispose, { once: true });
			const host: LobsterViewContext["host"] = {
				theme: {
					get colorMode() {
						assertActive();
						return theme.colorMode;
					},
					subscribe(listener) {
						assertActive();
						const stop = theme.subscribe(() => {
							if (!lifetime.signal.aborted) listener();
						});
						const unsubscribe = () => {
							if (themeSubscriptions.delete(unsubscribe)) stop();
						};
						themeSubscriptions.add(unsubscribe);
						if (lifetime.signal.aborted) unsubscribe();
						return unsubscribe;
					},
				},
				components: {
					mountDialog(container, props) {
						assertActive();
						return mountStandaloneDialog(container, props, lifetime.signal);
					},
				},
				connection: {
					get connected() {
						assertActive();
						return connected;
					},
				},
				workflows: {
					list: () => read(() => transport.list(lifetime.signal)),
					get: (id) =>
						read(() => {
							assertId(id);
							return transport.get(id, lifetime.signal);
						}),
					files: (id) =>
						read(() => {
							assertId(id);
							return transport.files(id, lifetime.signal);
						}),
					file: (id, path) =>
						read(() => {
							assertId(id);
							assertId(path);
							return transport.file(id, path, lifetime.signal);
						}),
				},
				subscribe(listener) {
					assertActive();
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				onWorkflowsChanged(listener) {
					assertActive();
					events.add(listener);
					return () => {
						events.delete(listener);
					};
				},
				errorMessage: workflowErrorMessage,
				navigation: {
					pageHref(target) {
						assertActive();
						return pageHref(target);
					},
					openPage(target) {
						assertActive();
						navigate(pageHref(target));
					},
				},
			};
			return { host, dispose };
		},
		setConnection(value: boolean) {
			if (owner.signal.aborted || value === connected) return;
			connected = value;
			notify();
		},
		notify,
		emitWorkflowsChanged() {
			for (const view of views) view.emitWorkflowsChanged();
		},
		dispose() {
			owner.abort();
			for (const view of views) view.dispose();
		},
	};
}
