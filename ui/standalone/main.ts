import "../theme/theme.css";
import {
	mountWorkflows,
	mountWorkflow,
	observeHostTheme,
	type LobsterViewContext,
} from "@clawdbot/lobster-viewer";
import { createStandaloneHost, readWorkflowResponse } from "./host.js";
import "./shell.css";

const app = document.querySelector<HTMLElement>("#app")!;
const options = new URLSearchParams(location.search);
const forcedOffline = import.meta.env.DEV && options.get("host") === "offline";
let lifetime: AbortController | undefined;
let disposeView: (() => void) | undefined;
let disposeHost: (() => void) | undefined;
let events: EventSource | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 500;
let disposed = false;

const appearance = new AbortController();
const theme = options.get("theme");
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const syncTheme = () => {
	const mode =
		theme === "light" || theme === "dark" ? theme : systemTheme.matches ? "dark" : "light";
	document.documentElement.dataset.themeMode = mode;
	document.documentElement.dataset.theme = mode;
};
systemTheme.addEventListener("change", syncTheme);
syncTheme();
const standalone = createStandaloneHost({
	theme: observeHostTheme(document.documentElement, appearance.signal),
	transport: {
		list: (signal) => readWorkflowResponse("/api/workflows", signal),
		get: (id, signal) => readWorkflowResponse(`/api/workflow?id=${encodeURIComponent(id)}`, signal),
		files: (id, signal) =>
			readWorkflowResponse(`/api/workflow/files?id=${encodeURIComponent(id)}`, signal),
		file: (id, path, signal) =>
			readWorkflowResponse(
				`/api/workflow/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
				signal,
			),
	},
	navigate(href) {
		history.pushState(null, "", href);
		render();
	},
});
const render = () => {
	lifetime?.abort();
	disposeView?.();
	disposeHost?.();
	app.replaceChildren();
	lifetime = new AbortController();
	const view = standalone.createView(lifetime.signal);
	disposeHost = view.dispose;
	const detail = location.pathname === "/workflow";
	const context: LobsterViewContext = {
		host: view.host,
		signal: lifetime.signal,
		presented: true,
		props: detail ? { workflowId: new URLSearchParams(location.search).get("id") ?? "" } : {},
	};
	disposeView = (detail ? mountWorkflow : mountWorkflows)(app, context)?.dispose;
};
const notifyChanges = () => standalone.emitWorkflowsChanged();
const closeEvents = () => {
	if (!events) return;
	events.onopen = null;
	events.onerror = null;
	events.removeEventListener("workflows-changed", notifyChanges);
	events.close();
	events = undefined;
};
const connectEvents = () => {
	if (disposed) return;
	closeEvents();
	const current = new EventSource("/api/events");
	events = current;
	current.onopen = () => {
		retryDelay = 500;
		standalone.setConnection(!forcedOffline);
	};
	current.onerror = () => {
		standalone.setConnection(false);
		// EventSource retries dropped streams itself, but a proxy 502 during a
		// server restart closes it permanently. Only replace that terminal state.
		if (current.readyState !== EventSource.CLOSED || reconnect !== undefined) return;
		closeEvents();
		reconnect = setTimeout(() => {
			reconnect = undefined;
			connectEvents();
		}, retryDelay);
		retryDelay = Math.min(retryDelay * 2, 10_000);
	};
	current.addEventListener("workflows-changed", notifyChanges);
};
connectEvents();
window.addEventListener("popstate", render);

render();

// Replacement owns one event stream and no listeners from an earlier mount.
const dispose = () => {
	disposed = true;
	appearance.abort();
	clearTimeout(reconnect);
	reconnect = undefined;
	lifetime?.abort();
	disposeView?.();
	disposeHost?.();
	standalone.dispose();
	closeEvents();
	window.removeEventListener("popstate", render);
	systemTheme.removeEventListener("change", syncTheme);
};
import.meta.hot?.dispose(dispose);
