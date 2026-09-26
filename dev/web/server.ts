import path from "node:path";
import { createServer } from "vite";
import { acceptLocalRequest, createWorkflowHttp } from "../../ui/standalone/http.js";
import config from "./vite.config.js";

if (process.env.NODE_ENV === "production") {
	throw new Error("Use lobster view for built assets; pnpm dev:web is development-only.");
}
const root = import.meta.dirname;
const workspace = path.resolve(process.env.LOBSTER_WORKSPACE ?? path.join(root, "workspace"));
const port = Number(process.env.LOBSTER_WEB_PORT ?? 5180);
let transport: Awaited<ReturnType<typeof createWorkflowHttp>> | undefined;
let failure: unknown;
const server = await createServer({
	...config,
	configFile: false,
	mode: "development",
	// Browser checks can run alongside the developer's preview.
	cacheDir: path.join(root, "node_modules/.vite", String(port)),
	optimizeDeps: { entries: ["index.html"] },
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		fs: { allow: [path.resolve(root, "../../ui")] },
	},
	plugins: [
		{
			name: "lobster-workflow-api",
			configureServer(vite) {
				vite.middlewares.use((request, response, next) => {
					if (!acceptLocalRequest(request, response)) return;
					void transport!.handle(request, response).then((handled) => {
						if (!handled) next();
					}, next);
				});
			},
		},
	],
});
let closing: Promise<void> | undefined;
const close = () => {
	if (closing) return closing;
	closing = (async () => {
		process.removeListener("SIGTERM", stop);
		process.removeListener("SIGINT", stop);
		try {
			await transport?.close();
		} finally {
			await server.close();
		}
	})();
	return closing;
};
const stop = () => {
	void close();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
	transport = await createWorkflowHttp(workspace, (error) => {
		failure = error;
		console.error(`Workflow watcher failed: ${String(error)}`);
		process.exitCode = 1;
		void close();
	});
	if (closing) {
		await transport.close();
		throw failure ?? new Error("Preview stopped.");
	}
	await transport.ready;
	await server.listen();
	server.printUrls();
} catch (error) {
	await close();
	throw error;
}
