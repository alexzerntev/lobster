import type { LobsterViewContext } from "@lobster/ui/view-context";

type MountDialog = LobsterViewContext["host"]["components"]["mountDialog"];
type DialogProps = Parameters<MountDialog>[1];

/** Native modal used by the development shell; the viewer owns its content. */
export function mountDevelopmentDialog(
	container: HTMLElement,
	props: DialogProps,
	signal: AbortSignal,
): ReturnType<MountDialog> {
	signal.throwIfAborted();
	const document = container.ownerDocument;
	const dialog = document.createElement("dialog");
	const ElementClass = document.defaultView?.HTMLElement;
	const originalFocus =
		ElementClass && document.activeElement instanceof ElementClass ? document.activeElement : null;
	let active = true;
	let opened = false;
	let backdropPress = false;
	const restoreFocus = () => {
		if (!opened) return;
		opened = false;
		const target = props.returnFocusTarget === undefined ? originalFocus : props.returnFocusTarget;
		if (target?.isConnected) target.focus({ preventScroll: true });
		else if (target === null && document.activeElement === originalFocus) originalFocus?.blur();
	};
	const cancel = () => {
		if (!active || !dialog.open) return;
		if (props.onCancel() !== false && active) dialog.close();
	};
	const onCancel = (event: Event) => {
		// Keep dismissal synchronous with the current viewer callback, including vetoes.
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
		dialog.className = "lobster-dev-dialog";
		dialog.style.cssText = props.style ?? "";
		dialog.setAttribute("aria-label", props.label);
		dialog.append(props.content);
		container.append(dialog);
		dialog.showModal();
		opened = true;
	} catch (error) {
		dispose();
		throw error;
	}
	return { dispose };
}
