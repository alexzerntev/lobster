import type { IncomingMessage, ServerResponse } from "node:http";
import { createWorkflowApi, WorkflowApiError } from "../server/workflows.js";
import { watchWorkflows } from "../server/watch-workflows.js";

/** Check the bound address as well as Origin: this server exposes local source files. */
export function acceptLocalRequest(request: IncomingMessage, response: ServerResponse): boolean {
	const port = request.socket.localPort;
	const host = request.headers.host;
	const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
	if (port === 80) {
		hosts.add("127.0.0.1");
		hosts.add("localhost");
	}
	let valid = Boolean(host && hosts.has(host));
	if (request.headers.origin) {
		try {
			const origin = new URL(request.headers.origin);
			valid &&= origin.origin === new URL(`http://${host}`).origin;
		} catch {
			valid = false;
		}
	}
	if (!valid) {
		response.writeHead(403, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
		response.end("Only local, same-origin requests are supported.");
	}
	return valid;
}

/** Shared read-only transport; each host owns one watcher and all its event streams. */
export async function createWorkflowHttp(workspace: string, failed: (error: unknown) => void) {
	const api = createWorkflowApi(workspace);
	const clients = new Set<ServerResponse>();
	let stopped = false;
	const broadcast = (message: string) => {
		for (const client of clients) {
			// A stalled client reconnects instead of accumulating an unbounded event buffer.
			if (!client.write(message)) client.destroy();
		}
	};
	const watcher = await watchWorkflows(
		workspace,
		() => broadcast("event: workflows-changed\ndata: {}\n\n"),
		failed,
	);
	const heartbeat = setInterval(() => broadcast(": heartbeat\n\n"), 30_000);
	heartbeat.unref();
	let closing: Promise<void> | undefined;
	return {
		ready: watcher.ready,
		close() {
			if (closing) return closing;
			stopped = true;
			clearInterval(heartbeat);
			for (const client of clients) client.end();
			clients.clear();
			closing = watcher.close();
			return closing;
		},
		async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
			const url = new URL(request.url ?? "/", "http://localhost");
			if (!url.pathname.startsWith("/api/")) return false;
			const send = (status: number, body: unknown) => {
				if (response.destroyed || response.writableEnded) return;
				response.writeHead(status, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
					"X-Content-Type-Options": "nosniff",
				});
				response.end(JSON.stringify(body));
			};
			if (stopped) {
				send(503, { error: "The viewer is shutting down." });
				return true;
			}
			if (request.method !== "GET") {
				response.setHeader("Allow", "GET");
				send(405, { error: "Only read-only GET requests are supported." });
				return true;
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
				return true;
			}
			try {
				switch (url.pathname) {
					case "/api/health":
						send(200, { ok: true });
						break;
					case "/api/workflows":
						send(200, await api.list());
						break;
					case "/api/workflow":
						send(200, await api.get(url.searchParams.get("id") ?? ""));
						break;
					case "/api/workflow/files":
						send(200, await api.files(url.searchParams.get("id") ?? ""));
						break;
					case "/api/workflow/file":
						send(
							200,
							await api.file(url.searchParams.get("id") ?? "", url.searchParams.get("path") ?? ""),
						);
						break;
					default:
						send(404, { error: "Unknown endpoint." });
				}
			} catch (error) {
				send(error instanceof WorkflowApiError ? error.statusCode : 500, {
					error:
						error instanceof WorkflowApiError
							? { type: "workflow", message: error.message }
							: { type: "internal", message: "Could not read workflow." },
				});
			}
			return true;
		},
	};
}
