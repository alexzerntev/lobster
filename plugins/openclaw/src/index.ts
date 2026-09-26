import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createWorkflowApi, WorkflowApiError } from "../../../ui/server/workflows.js";
import { watchWorkflows } from "../../../ui/server/watch-workflows.js";
import { methods, pluginId } from "./contract.js";

export default definePluginEntry({
	id: pluginId,
	name: "Lobster",
	description: "Read-only Lobster workflow graphs and source files",
	register(api) {
		let current: ReturnType<typeof createWorkflowApi> | undefined;
		let stopWatching: (() => Promise<void>) | undefined;
		api.registerService({
			id: `${pluginId}:workflows`,
			async start(context) {
				current = undefined;
				await stopWatching?.();
				stopWatching = undefined;
				if (!context.workspaceDir)
					throw new Error("Lobster viewer requires a default agent workspace.");
				const emit = () =>
					context.gatewayEvents?.emit("workflows-changed", {}, { scope: "operator.read" });
				const inspection = createWorkflowApi(
					context.workspaceDir,
					new URL("./github_pr_monitor.ts", import.meta.url),
				);
				current = inspection;
				let watcher: Awaited<ReturnType<typeof watchWorkflows>> | undefined;
				try {
					watcher = await watchWorkflows(context.workspaceDir, emit, (error) => {
						context.logger.error(`Lobster workflow watcher failed: ${String(error)}`);
						context.serviceHealth?.reportFailure(error);
					});
					if (current !== inspection) {
						await watcher.close();
						return;
					}
					stopWatching = watcher.close;
					await watcher.ready;
				} catch (error) {
					if (current === inspection) current = undefined;
					await watcher?.close();
					throw error;
				}
				if (current === inspection) emit();
			},
			async stop() {
				current = undefined;
				const stop = stopWatching;
				stopWatching = undefined;
				await stop?.();
			},
		});
		for (const operation of Object.keys(methods) as (keyof typeof methods)[]) {
			api.registerGatewayMethod(
				methods[operation],
				async ({ params, respond }) => {
					const active = current;
					try {
						if (!active)
							throw new WorkflowApiError(
								"Lobster viewer is unavailable. Check the plugin service and default workspace.",
								503,
							);
						const keys = operation === "list" ? [] : operation === "file" ? ["id", "path"] : ["id"];
						if (
							Object.keys(params).length !== keys.length ||
							keys.some(
								(key) =>
									typeof params[key] !== "string" ||
									!params[key] ||
									params[key].length > (key === "id" ? 2800 : 2048),
							)
						) {
							throw new WorkflowApiError("Select a workflow or a source file from its tree.", 400);
						}
						const result =
							operation === "list"
								? await active.list()
								: operation === "get"
									? await active.get(String(params.id))
									: operation === "files"
										? await active.files(String(params.id))
										: await active.file(String(params.id), String(params.path));
						if (active !== current)
							throw new WorkflowApiError(
								"Lobster viewer restarted. Please reopen the workflow.",
								503,
							);
						respond(true, { ok: true, result });
					} catch (error) {
						respond(true, {
							ok: false,
							error: error instanceof WorkflowApiError ? error.message : "Could not read workflow.",
						});
					}
				},
				{ scope: "operator.read" },
			);
		}
	},
});
