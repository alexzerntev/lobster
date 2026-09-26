import type { LobsterViewContext } from "../../../ui/src/view-context.js";

export const pluginId = "lobster-viewer";
export const changedEvent = `plugin.${pluginId}.workflows-changed`;
export const methods = {
	list: "lobster-viewer.workflows.list",
	get: "lobster-viewer.workflows.get",
	files: "lobster-viewer.workflows.files",
	file: "lobster-viewer.workflows.file",
} as const;
export type Workflows = LobsterViewContext["host"]["workflows"];
export type WorkflowResponse<T> = { ok: true; result: T } | { ok: false; error: string };
