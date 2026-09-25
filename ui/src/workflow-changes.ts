import type { LobsterViewContext } from "./view-context.js";

/** One subscription per mounted view; bursts retain at most one pending refresh. */
export function subscribeWorkflowChanges(
	{ host, signal, presented: initialPresented }: LobsterViewContext,
	reload: () => Promise<void>,
	relevant: () => boolean = () => true,
) {
	let presented = initialPresented;
	let disposed = false;
	let pending = false;
	let scheduled = false;
	const flush = () => {
		if (
			disposed ||
			!presented ||
			!pending ||
			scheduled ||
			!host.connection.connected ||
			!relevant()
		) {
			return;
		}
		scheduled = true;
		const refresh = async () => {
			try {
				if (disposed || !presented || !host.connection.connected || !relevant()) {
					return;
				}
				pending = false;
				// The view owns request errors and stale-result fencing, including route changes.
				await reload();
			} finally {
				scheduled = false;
				flush();
			}
		};
		queueMicrotask(() => void refresh());
	};
	const unsubscribe = host.onEvent("lobster.workflows-changed", () => {
		if (!disposed && relevant()) {
			pending = true;
			flush();
		}
	});
	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		pending = false;
		unsubscribe();
		signal.removeEventListener("abort", dispose);
	};
	signal.addEventListener("abort", dispose, { once: true });
	if (signal.aborted) {
		dispose();
	}
	return {
		update: (context: LobsterViewContext) => {
			presented = context.presented;
			if (!relevant()) {
				pending = false;
			}
			flush();
		},
		dispose,
	};
}
