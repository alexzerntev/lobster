import { resolve } from "node:path";
import { parseArgs } from "node:util";

export async function handleView({ argv, signal }: { argv: string[]; signal: AbortSignal }) {
	let workspace: string;
	let port: number;
	try {
		const { values } = parseArgs({
			args: argv,
			options: {
				workspace: { type: "string" },
				port: { type: "string", default: "5180" },
				help: { type: "boolean", short: "h" },
			},
		});
		if (values.help) {
			process.stdout.write(viewHelpText());
			return;
		}
		if (values.workspace === "") throw new Error("view --workspace requires a directory");
		if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) {
			throw new Error("view --port must be an integer between 0 and 65535");
		}
		workspace = resolve(values.workspace ?? process.cwd());
		port = Number(values.port);
	} catch (err) {
		process.stderr.write(`Parse error: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exitCode = 2;
		return;
	}

	try {
		const { startWorkflowServer } = await import("../ui/standalone/server.js");
		const server = await startWorkflowServer({ workspace, port, signal });
		try {
			process.stdout.write(`Lobster viewer: ${server.url}\nPress Ctrl+C to stop.\n`);
			await server.closed;
		} finally {
			await server.close();
		}
	} catch (err) {
		if (!signal.aborted) {
			process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
			process.exitCode = 1;
		}
	}
}

function viewHelpText() {
	return (
		`lobster view — inspect workflows in a local browser\n\n` +
		`Usage:\n` +
		`  lobster view [--workspace <directory>] [--port <port>]\n\n` +
		`Flags:\n` +
		`  --workspace  Workspace directory (default: current directory)\n` +
		`  --port       Local port (default: 5180; 0 selects an available port)\n` +
		`  -h, --help   Show this help\n\n` +
		`The read-only viewer listens on 127.0.0.1 and updates when workflow files change.\n`
	);
}
