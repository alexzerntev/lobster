import { mountWorkflow, observeHostTheme } from "@clawdbot/lobster-viewer";
import { createThemeDriver } from "virtual:lobster-theme-driver";
import { createDevelopmentHost, readPreview } from "../preview-host.js";
import "../shell.css";

const driver = createThemeDriver(document.documentElement);
const lifetime = new AbortController();
const theme = observeHostTheme(document.documentElement, lifetime.signal, driver.subscribe);
const preview = createDevelopmentHost({
	theme,
	transport: {
		list: (signal) => readPreview("/api/workflows", signal),
		get: (id, signal) => readPreview(`/api/workflow?id=${encodeURIComponent(id)}`, signal),
		files: (id, signal) => readPreview(`/api/workflow/files?id=${encodeURIComponent(id)}`, signal),
		file: (id, path, signal) =>
			readPreview(
				`/api/workflow/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
				signal,
			),
	},
	navigate: () => {
		throw new Error("Navigation is outside the theme compatibility check.");
	},
});
preview.setConnection(true);
const { host } = preview.createView(lifetime.signal);
mountWorkflow(document.querySelector<HTMLElement>("#app")!, {
	host,
	signal: lifetime.signal,
	presented: true,
	props: { workflowId: "file:bm9kZS10eXBlcy5sb2JzdGVy" },
});
const notify = () => {
	document.querySelector("#notifications")!.textContent = String(driver.notifications);
};
const stop = driver.subscribe(notify);
document.querySelector("#light")!.addEventListener("click", () => driver.setMode("light"));
document.querySelector("#dark")!.addEventListener("click", () => driver.setMode("dark"));
document.querySelector("#knot")!.addEventListener("click", () => {
	driver.setFamily("knot");
	driver.setMode("dark");
});
const dispose = () => {
	lifetime.abort();
	preview.dispose();
	stop();
	driver.dispose();
};
document.querySelector("#dispose")!.addEventListener("click", dispose);
import.meta.hot?.dispose(dispose);
