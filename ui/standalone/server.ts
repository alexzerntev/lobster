import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptLocalRequest, createWorkflowHttp } from "./http.js";

const assetRoot = fileURLToPath(new URL("../../view/", import.meta.url));
const contentTypes: Record<string, string> = {
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
};

async function serveAsset(request: IncomingMessage, response: ServerResponse, index: Buffer) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { Allow: "GET, HEAD" });
		response.end();
		return;
	}
	const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
	let body: Buffer;
	let type: string;
	if (pathname === "/" || pathname === "/workflow") {
		body = index;
		type = "text/html; charset=utf-8";
	} else {
		try {
			const decoded = decodeURIComponent(pathname);
			if (
				!decoded.startsWith("/assets/") ||
				decoded.includes("\\") ||
				decoded.split("/").some((part) => part.startsWith("."))
			)
				throw new Error("Invalid asset");
			type = contentTypes[path.extname(decoded)];
			if (!type) throw new Error("Unknown asset type");
			const filename = await realpath(path.join(assetRoot, decoded));
			if (!filename.startsWith(`${await realpath(assetRoot)}${path.sep}`))
				throw new Error("Invalid asset");
			body = await readFile(filename);
		} catch {
			response.writeHead(404);
			response.end("Not found");
			return;
		}
	}
	if (response.destroyed) return;
	response.writeHead(200, {
		"Content-Type": type,
		"Content-Length": body.length,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(request.method === "HEAD" ? undefined : body);
}

/** Serves packaged assets locally; no build tools or workflow execution are loaded. */
export async function startWorkflowServer({
	workspace,
	port,
	signal,
}: {
	workspace: string;
	port: number;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	let index: Buffer;
	try {
		index = await readFile(path.join(assetRoot, "index.html"));
	} catch {
		throw new Error(
			"Viewer assets are missing. Build the checkout with pnpm build or reinstall Lobster.",
		);
	}
	let transport: Awaited<ReturnType<typeof createWorkflowHttp>> | undefined;
	let closing: Promise<void> | undefined;
	let failure: unknown;
	let finish: () => void;
	const closed = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const server = createServer((request, response) => {
		if (!acceptLocalRequest(request, response)) return;
		void (async () => {
			try {
				if (!(await transport!.handle(request, response)))
					await serveAsset(request, response, index);
			} catch {
				if (!response.headersSent) response.writeHead(500);
				response.end("Could not serve viewer.");
			}
		})();
	});
	const close = () => {
		if (closing) return closing;
		signal?.removeEventListener("abort", abort);
		closing = (async () => {
			try {
				await transport?.close();
			} catch (error) {
				failure ??= error;
			} finally {
				await new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				});
				finish();
			}
		})();
		return closing;
	};
	const abort = () => {
		void close();
	};
	const failed = (error: unknown) => {
		failure = error;
		void close();
	};
	try {
		transport = await createWorkflowHttp(workspace, failed);
		if (closing) {
			await transport.close();
			throw failure;
		}
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) await close();
		await transport.ready;
		signal?.throwIfAborted();
		if (failure) throw failure;
		const listening = once(server, "listening", { signal });
		server.listen(port, "127.0.0.1");
		await listening;
		server.on("error", failed);
		if (signal?.aborted) {
			await close();
			signal.throwIfAborted();
		}
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Viewer did not start.");
		return {
			url: `http://127.0.0.1:${address.port}`,
			closed: closed.then(() => {
				if (failure) throw failure;
			}),
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}
