import type { LobsterWorkflowDetail } from "../workflow-types.js";
import { subworkflowTarget } from "./subworkflow-target.js";
import type { LobsterView, LobsterViewContext } from "./view-context.js";

/** The host owns modal behavior; the embedded view owns its requests and graph lifetime. */
export function openSubworkflowDialog({
	container,
	context,
	workflow,
	nodeId,
	trigger,
	currentTrigger,
	mount,
}: {
	container: HTMLElement;
	context: LobsterViewContext;
	workflow: LobsterWorkflowDetail;
	nodeId: string;
	trigger: HTMLElement;
	currentTrigger: () => HTMLElement | null;
	mount: (
		element: HTMLElement,
		context: LobsterViewContext,
		close: () => void,
	) => ReturnType<LobsterView>;
}): () => void {
	const lifetime = new AbortController();
	const portal = document.createElement("div");
	portal.className = "lobster-subworkflow-portal";
	const content = document.createElement("div");
	content.className = "lobster-subworkflow";
	container.append(portal);
	let disposed = false;
	let child: ReturnType<LobsterView>;
	let dialog: ReturnType<LobsterViewContext["host"]["components"]["mountDialog"]> | undefined;
	const close = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		lifetime.abort();
		child?.dispose?.();
		child = undefined;
		dialog?.dispose();
		dialog = undefined;
		portal.remove();
		context.signal.removeEventListener("abort", close);
		// A filesystem refresh can replace the original card while the dialog is open.
		if (!trigger.isConnected && !context.signal.aborted) {
			currentTrigger()?.focus({ preventScroll: true });
		}
	};
	context.signal.addEventListener("abort", close, { once: true });
	let target: ReturnType<typeof subworkflowTarget> | undefined;
	let error: string | undefined;
	try {
		target = subworkflowTarget(workflow, nodeId);
	} catch (reason) {
		error = reason instanceof Error ? reason.message : "Cannot resolve this subworkflow.";
	}
	if (target) {
		child = mount(
			content,
			{
				...context,
				signal: lifetime.signal,
				props: { workflowId: target.id },
			},
			close,
		);
	} else {
		const message = document.createElement("p");
		message.setAttribute("role", "alert");
		message.textContent = error ?? "Cannot resolve this subworkflow.";
		const dismiss = document.createElement("button");
		dismiss.type = "button";
		dismiss.className = "btn btn--sm";
		dismiss.textContent = "Close";
		dismiss.addEventListener("click", close, { signal: lifetime.signal });
		content.classList.add("lobster-subworkflow--error");
		content.append(message, dismiss);
	}
	// Populate the close control before the host chooses the initial modal focus.
	dialog = context.host.components.mountDialog(portal, {
		label: target ? `Subworkflow: ${target.filename}` : "Subworkflow unavailable",
		content,
		style: "--lobster-modal-width: 1120px;",
		returnFocusTarget: trigger,
		onCancel: close,
	});
	return close;
}
