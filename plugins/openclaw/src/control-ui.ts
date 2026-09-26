import {
	defineControlUiPlugin,
	type ControlUiView,
	type ControlUiViewContext,
} from "openclaw/plugin-sdk/control-ui";
import {
	mountWorkflow,
	mountWorkflows,
	observeHostTheme,
	type LobsterView,
	type LobsterViewContext,
} from "../../../ui/src/index.js";
import { WorkflowViewError, workflowErrorMessage } from "../../../ui/src/view-context.js";
import {
	methods,
	pluginId,
	changedEvent,
	type WorkflowResponse,
	type Workflows,
} from "./contract.js";

function adapt(view: LobsterView): ControlUiView {
	return (container, context) => {
		const owner = new AbortController();
		const abort = () => owner.abort();
		context.signal.addEventListener("abort", abort, { once: true });
		if (context.signal.aborted) abort();
		const host = context.host;
		try {
			const theme = observeHostTheme(
				container.ownerDocument.documentElement,
				owner.signal,
				host.subscribe,
			);
			const request = async <K extends keyof Workflows>(
				operation: K,
				params: Record<string, unknown> = {},
			): Promise<Awaited<ReturnType<Workflows[K]>>> => {
				owner.signal.throwIfAborted();
				const response = await host.request<WorkflowResponse<Awaited<ReturnType<Workflows[K]>>>>(
					methods[operation],
					params,
				);
				owner.signal.throwIfAborted();
				if (!response.ok) throw new WorkflowViewError(response.error);
				return response.result;
			};
			const adaptedHost: LobsterViewContext["host"] = {
				theme,
				connection: host.connection,
				components: host.components,
				navigation: host.navigation,
				subscribe: host.subscribe,
				onWorkflowsChanged: (listener) => host.onEvent(changedEvent, listener),
				errorMessage: workflowErrorMessage,
				workflows: {
					list: () => request("list"),
					get: (id) => request("get", { id }),
					files: (id) => request("files", { id }),
					file: (id, path) => request("file", { id, path }),
				},
			};
			const adaptContext = (value: ControlUiViewContext): LobsterViewContext => ({
				host: adaptedHost,
				signal: owner.signal,
				props: value.props,
				presented: value.presented,
			});
			const mounted = view(container, adaptContext(context));
			return {
				update: (next) => mounted?.update?.(adaptContext(next)),
				dispose() {
					owner.abort();
					context.signal.removeEventListener("abort", abort);
					mounted?.dispose?.();
				},
			};
		} catch (error) {
			owner.abort();
			context.signal.removeEventListener("abort", abort);
			throw error;
		}
	};
}

export default defineControlUiPlugin({
	id: pluginId,
	activate(host) {
		const dispose = [
			host.ui.registerPage({ id: "workflows", label: "Lobster", mount: adapt(mountWorkflows) }),
			host.ui.registerPage({
				id: "workflow",
				label: "Lobster workflow",
				mount: adapt(mountWorkflow),
			}),
			host.ui.registerNavigation({
				id: "workflows",
				label: "Lobster",
				page: { id: "workflows" },
				icon: "gitFork",
			}),
		];
		return () => {
			for (const stop of dispose.reverse()) stop();
		};
	},
});
