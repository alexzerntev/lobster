import type { LobsterViewContext } from "../../../openclaw/extensions/lobster/browser/view-context.js";

type MountDialog = LobsterViewContext["host"]["components"]["mountDialog"];
type DialogProps = Parameters<MountDialog>[1];

/** Development-only stand-in for the public host dialog; the plugin owns its content. */
export function mountDevelopmentDialog(
	container: HTMLElement,
	initial: DialogProps,
	signal: AbortSignal,
): ReturnType<MountDialog> {
	signal.throwIfAborted();
	const document = container.ownerDocument;
	const dialog = document.createElement("dialog");
	const ElementClass = document.defaultView?.HTMLElement;
	const originalFocus =
		ElementClass && document.activeElement instanceof ElementClass ? document.activeElement : null;
	let props = initial;
	let active = true;
	let opened = false;
	let backdropPress = false;
	let returnFocusOverride: HTMLElement | null | undefined;
	const restoreFocus = () => {
		if (!opened) return;
		opened = false;
		const target = returnFocusOverride === undefined ? originalFocus : returnFocusOverride;
		if (target?.isConnected) target.focus({ preventScroll: true });
		else if (target === null && document.activeElement === originalFocus) originalFocus?.blur();
	};
	const apply = () => {
		dialog.className = `lobster-dev-dialog ${props.className ?? ""}`.trim();
		dialog.style.cssText = props.style ?? "";
		dialog.setAttribute("aria-label", props.label);
		if (props.description) dialog.setAttribute("aria-description", props.description);
		else dialog.removeAttribute("aria-description");
		if (props.returnFocusTarget !== undefined) returnFocusOverride = props.returnFocusTarget;
		if (dialog.firstChild !== props.content) dialog.replaceChildren(props.content);
	};
	const cancel = () => {
		if (!active || !dialog.open) return;
		if (props.onCancel() !== false && active) dialog.close();
	};
	const onCancel = (event: Event) => {
		// Keep dismissal synchronous with the current plugin callback, including vetoes.
		event.preventDefault();
		cancel();
	};
	const isBackdrop = (event: MouseEvent) => {
		if (event.target !== dialog) return false;
		const rect = dialog.getBoundingClientRect();
		return (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		);
	};
	const onPointerDown = (event: PointerEvent) => {
		backdropPress = isBackdrop(event);
	};
	const onClick = (event: MouseEvent) => {
		const dismiss = backdropPress && isBackdrop(event);
		backdropPress = false;
		if (dismiss) cancel();
	};
	const dispose = () => {
		if (!active) return;
		active = false;
		signal.removeEventListener("abort", dispose);
		dialog.removeEventListener("cancel", onCancel);
		dialog.removeEventListener("pointerdown", onPointerDown);
		dialog.removeEventListener("click", onClick);
		dialog.removeEventListener("close", restoreFocus);
		if (dialog.open) dialog.close();
		dialog.remove();
		if (opened) restoreFocus();
	};
	dialog.addEventListener("cancel", onCancel);
	dialog.addEventListener("pointerdown", onPointerDown);
	dialog.addEventListener("click", onClick);
	dialog.addEventListener("close", restoreFocus);
	signal.addEventListener("abort", dispose, { once: true });
	try {
		apply();
		container.append(dialog);
		dialog.showModal();
		opened = true;
	} catch (error) {
		dispose();
		throw error;
	}
	return {
		update(next) {
			signal.throwIfAborted();
			if (!active) throw new Error("This development dialog has been disposed.");
			props = next;
			apply();
		},
		dispose,
	};
}
