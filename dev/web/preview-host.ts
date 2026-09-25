import type { LobsterPageTarget, LobsterViewContext } from "@lobster/ui/view-context";
import type {
	LobsterWorkflowFileResult,
	LobsterWorkflowFilesResult,
	LobsterWorkflowResult,
	LobsterWorkflowsResult,
} from "@lobster/ui/workflow-types";
import { mountDevelopmentDialog } from "./dialog.js";

type WorkflowTransport = {
	list: (signal: AbortSignal) => Promise<LobsterWorkflowsResult>;
	get: (id: string, signal: AbortSignal) => Promise<LobsterWorkflowResult>;
	files: (id: string, signal: AbortSignal) => Promise<LobsterWorkflowFilesResult>;
	file: (id: string, path: string, signal: AbortSignal) => Promise<LobsterWorkflowFileResult>;
};

const messages = {
	request: "This request is not supported by the development preview.",
	params:
		"Invalid development request parameters. Select a workflow or a source file from its tree.",
	event: "This event is not supported by the development preview.",
	page: "This page is not supported by the development preview.",
	pageParams: "Invalid development page parameters. Select a workflow from the list.",
	disconnected: "The development server is disconnected. Check that it is running and retry.",
};
const safeMessages = new Set(Object.values(messages));

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
	if (!hasKeys(target, ["id", "params"])) throw new Error(messages.pageParams);
	if (target.id === "workflows") {
		if (target.params !== undefined && !hasKeys(target.params, [])) {
			throw new Error(messages.pageParams);
		}
		return "/";
	}
	if (target.id !== "workflow") throw new Error(messages.page);
	if (!hasKeys(target.params, ["workflowId"]) || !workflowId(target.params.workflowId)) {
		throw new Error(messages.pageParams);
	}
	return `/workflow?id=${encodeURIComponent(target.params.workflowId)}`;
}

/**
 * Development adapter for Lobster views: local reads, navigation, and lifecycle.
 * Unknown capabilities fail explicitly; there is no workflow execution transport.
 */
export function createDevelopmentHost({
	transport,
	navigate,
}: {
	transport: WorkflowTransport;
	navigate: (href: string) => void;
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
			const events = new Set<(payload: unknown) => void>();
			const assertActive = () => lifetime.signal.throwIfAborted();
			const dispose = () => {
				if (lifetime.signal.aborted) return;
				lifetime.abort();
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
						if (!lifetime.signal.aborted) listener({});
					}
				},
				dispose,
			};
			views.add(view);
			signal.addEventListener("abort", dispose, { once: true });
			const host: LobsterViewContext["host"] = {
				components: {
					mountDialog(container, props) {
						assertActive();
						return mountDevelopmentDialog(container, props, lifetime.signal);
					},
				},
				connection: {
					get connected() {
						assertActive();
						return connected;
					},
				},
				async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
					assertActive();
					let read: () => Promise<
						| LobsterWorkflowsResult
						| LobsterWorkflowResult
						| LobsterWorkflowFilesResult
						| LobsterWorkflowFileResult
					>;
					if (method === "lobster.workflows.list") {
						if (!hasKeys(params, [])) throw new Error(messages.params);
						read = () => transport.list(lifetime.signal);
					} else if (method === "lobster.workflows.get" || method === "lobster.workflows.files") {
						if (!hasKeys(params, ["id"]) || !workflowId(params.id)) {
							throw new Error(messages.params);
						}
						const id = params.id;
						read = () =>
							method === "lobster.workflows.get"
								? transport.get(id, lifetime.signal)
								: transport.files(id, lifetime.signal);
					} else if (method === "lobster.workflows.file") {
						if (
							!hasKeys(params, ["id", "path"]) ||
							!workflowId(params.id) ||
							!workflowId(params.path)
						) {
							throw new Error(messages.params);
						}
						const { id, path } = params;
						read = () => transport.file(id, path, lifetime.signal);
					} else {
						throw new Error(messages.request);
					}
					if (!connected) throw new Error(messages.disconnected);
					const result = await read();
					assertActive();
					// The view's caller-selected result type is retained only at this adapter boundary.
					return result as T;
				},
				subscribe(listener) {
					assertActive();
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				onEvent(event, listener) {
					assertActive();
					if (event !== "lobster.workflows-changed") throw new Error(messages.event);
					events.add(listener);
					return () => {
						events.delete(listener);
					};
				},
				redact(text) {
					assertActive();
					// Mask untrusted errors before displaying them; source content has its own explicit view.
					return safeMessages.has(text)
						? text
						: "Development request failed. Check the development server and workflow file. Details are hidden by the preview adapter.";
				},
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
