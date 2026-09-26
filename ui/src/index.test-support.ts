import { afterEach, vi } from "vitest";
import type { LobsterSourceLanguage } from "../workflow-types.js";
import { mountWorkflow, mountWorkflows, type LobsterViewContext } from "./index.js";
import { workflowErrorMessage } from "./workflow-errors.js";

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
	const events = new Set<() => void>();
	const workflows = {
		list: vi.fn<LobsterViewContext["host"]["workflows"]["list"]>(),
		get: vi.fn<LobsterViewContext["host"]["workflows"]["get"]>(),
		files: vi.fn<LobsterViewContext["host"]["workflows"]["files"]>(),
		file: vi.fn<LobsterViewContext["host"]["workflows"]["file"]>(),
	};
	const connection = { connected: true };
	const host: LobsterViewContext["host"] = {
		theme: { colorMode: "light", subscribe: () => () => {} },
		errorMessage: workflowErrorMessage,
		connection,
		workflows,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onWorkflowsChanged(listener) {
			events.add(listener);
			return () => events.delete(listener);
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
		...workflows,
		mount,
		container,
		abort,
		events,
		changed() {
			events.forEach((listener) => listener());
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
	fixture.files.mockResolvedValueOnce({
		files: [{ path, language }],
		defaultPath: path,
		truncated: false,
	});
	fixture.file.mockResolvedValueOnce({ file: { path, language, text } });
}
