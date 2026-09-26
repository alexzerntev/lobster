import path from "node:path";
import { watchWorkflows } from "../../ui/server/watch-workflows.js";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { createServer } from "vite";
import { createWorkflowApi, WorkflowApiError } from "../../ui/server/workflows.js";

if (process.env.NODE_ENV === "production") {
	throw new Error("The Lobster preview server is development-only; it is not a production server.");
}

const root = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(root, "../../ui");
const workspace = path.resolve(process.env.LOBSTER_WORKSPACE ?? path.join(root, "workspace"));
const port = Number(process.env.LOBSTER_WEB_PORT ?? 5180);
const api = createWorkflowApi(workspace);
const clients = new Set<ServerResponse>();
let heartbeat: ReturnType<typeof setInterval> | undefined;

const server = await createServer({
	configFile: false,
	mode: "development",
	publicDir: false,
	root,
	// A browser check can run alongside the developer's preview with different host assets.
	cacheDir: path.join(root, "node_modules/.vite", String(port)),
	optimizeDeps: { entries: ["index.html"] },
	resolve: {
		dedupe: ["react", "react-dom"],
	},
	server: {
		host: process.env.LOBSTER_WEB_HOST ?? "127.0.0.1",
		port,
		strictPort: true,
		fs: {
			allow: [root, uiRoot],
		},
	},
	plugins: [
		...(process.env.LOBSTER_OPENCLAW_ROOT
			? [(await import("./theme-check/plugin.js")).createOpenClawThemeCheck()]
			: []),
		{
			name: "lobster-development-api",
			configureServer(vite) {
				vite.middlewares.use((request, response, next) => {
					const url = new URL(request.url ?? "/", "http://localhost");
					if (!url.pathname.startsWith("/api/")) return next();
					const send = (status: number, body: unknown) => {
						response.writeHead(status, {
							"Content-Type": "application/json",
							"Cache-Control": "no-store",
						});
						response.end(JSON.stringify(body));
					};
					if (request.method !== "GET")
						return send(405, { error: "Only read-only GET requests are supported." });
					if (
						request.headers.origin &&
						new URL(request.headers.origin).host !== request.headers.host
					) {
						return send(403, { error: "Cross-origin requests are not supported." });
					}
					if (url.pathname === "/api/events") {
						response.writeHead(200, {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							"X-Accel-Buffering": "no",
						});
						response.write("event: workflows-changed\ndata: {}\n\n");
						clients.add(response);
						response.on("close", () => clients.delete(response));
						return;
					}
					void (async () => {
						try {
							if (url.pathname === "/api/health") return send(200, { ok: true });
							if (url.pathname === "/api/workflows") return send(200, await api.list());
							if (url.pathname === "/api/workflow")
								return send(200, await api.get(url.searchParams.get("id") ?? ""));
							if (url.pathname === "/api/workflow/files")
								return send(200, await api.files(url.searchParams.get("id") ?? ""));
							if (url.pathname === "/api/workflow/file")
								return send(
									200,
									await api.file(
										url.searchParams.get("id") ?? "",
										url.searchParams.get("path") ?? "",
									),
								);
							send(404, { error: "Unknown endpoint." });
						} catch (error) {
							send(error instanceof WorkflowApiError ? error.statusCode : 500, {
								error:
									error instanceof WorkflowApiError
										? { type: "workflow", message: error.message }
										: { type: "internal", message: "Could not read workflow." },
							});
						}
					})();
				});
			},
		},
	],
});

const workflowWatch = watchWorkflows(
	workspace,
	() => {
		for (const client of clients) client.write("event: workflows-changed\ndata: {}\n\n");
	},
	(error) => server.config.logger.error(`Workflow watcher failed: ${String(error)}`),
);
heartbeat = setInterval(() => {
	for (const client of clients) client.write(": heartbeat\n\n");
}, 30_000);
heartbeat.unref();
let closing = false;
const close = async () => {
	if (closing) return;
	closing = true;
	clearInterval(heartbeat);
	await workflowWatch.close();
	for (const client of clients) client.end();
	clients.clear();
	await server.close();
};
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
await workflowWatch.ready;
await server.listen();
server.printUrls();
