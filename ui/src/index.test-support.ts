import { afterEach, vi } from "vitest";
import type { LobsterSourceLanguage } from "../workflow-types.js";
import { mountWorkflow, mountWorkflows, type LobsterViewContext } from "./index.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
	cleanups
		.splice(0)
		.toReversed()
		.forEach((cleanup) => cleanup());
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

export async function createViewFixture(
	pageId: "workflows" | "workflow" = "workflows",
	workflowId = "",
) {
	const abort = new AbortController();
	const listeners = new Set<() => void>();
	const events = new Map<string, Set<(payload: unknown) => void>>();
	const connection = { connected: true };
	const host: LobsterViewContext["host"] = {
		redact: (text) => text,
		connection,
		request: vi.fn(),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onEvent(event, listener) {
			let subscriptions = events.get(event);
			if (!subscriptions) {
				subscriptions = new Set();
				events.set(event, subscriptions);
			}
			subscriptions.add(listener);
			return () => subscriptions.delete(listener);
		},
		get components(): never {
			throw new Error("No host component fixture installed");
		},
		navigation: {
			openPage: vi.fn(),
			pageHref: ({ id, params }) =>
				id === "workflows" ? "/" : `/workflow?id=${encodeURIComponent(params?.workflowId ?? "")}`,
		},
	};
	const container = document.createElement("div");
	document.body.append(container);
	const mountPage = pageId === "workflows" ? mountWorkflows : mountWorkflow;
	const context = {
		host,
		signal: abort.signal,
		props: { workflowId },
		presented: true,
	};
	let view: ReturnType<typeof mountPage>;
	const mount = () => {
		view = mountPage(container, context);
		cleanups.push(() => view?.dispose?.());
	};
	cleanups.push(() => {
		abort.abort();
	});
	return {
		request: vi.mocked(host.request),
		mount,
		container,
		abort,
		events,
		changed() {
			events.get("lobster.workflows-changed")?.forEach((listener) => listener({}));
		},
		present(presented: boolean) {
			context.presented = presented;
			view?.update?.(context);
		},
		openPage: vi.mocked(host.navigation.openPage),
		navigate(id: string) {
			context.props = { workflowId: id };
			view?.update?.(context);
		},
		connect(connected: boolean) {
			connection.connected = connected;
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

export function mockSource(
	fixture: Awaited<ReturnType<typeof createViewFixture>>,
	path: string,
	text: string,
	language: LobsterSourceLanguage = "yaml",
) {
	fixture.request
		.mockResolvedValueOnce({ files: [{ path, language }], defaultPath: path, truncated: false })
		.mockResolvedValueOnce({ file: { path, language, text } });
}
