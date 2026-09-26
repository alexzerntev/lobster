import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type {
	OpenClawPluginApi,
	OpenClawPluginService,
	OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/plugin-entry";
import plugin from "../dist/index.js";

type GatewayHandler = Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1];

const workflowId = `file:${Buffer.from("inspect.lobster").toString("base64url")}`;
const definition =
	"name: Inspect me\nsteps:\n  - id: inspect\n    command: node scripts/helper.js\n";

async function workspace(t: TestContext, name = "Inspect me") {
	const directory = await mkdtemp(path.join(os.tmpdir(), "lobster-plugin-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await mkdir(path.join(directory, "workflows", "scripts"), { recursive: true });
	await writeFile(
		path.join(directory, "workflows", "inspect.lobster"),
		definition.replace("Inspect me", name),
	);
	return directory;
}

function host(t: TestContext) {
	const handlers = new Map<string, GatewayHandler>();
	const services: OpenClawPluginService[] = [];
	const active = new Map<OpenClawPluginService, OpenClawPluginServiceContext>();
	const events: { event: string; payload: unknown; scope: string }[] = [];
	const errors: string[] = [];
	const api = {
		registerGatewayMethod(method, handler, options) {
			assert.equal(options?.scope, "operator.read", `${method} must remain a read-only operation`);
			assert.equal(handlers.has(method), false);
			handlers.set(method, handler);
		},
		registerService(service) {
			services.push(service);
		},
	} satisfies Pick<OpenClawPluginApi, "registerGatewayMethod" | "registerService">;
	// Exercise the built entry with only the host capabilities it actually consumes.
	Reflect.apply(plugin.register, plugin, [api]);
	const stop = async () => {
		for (const [service, context] of [...active].reverse()) {
			active.delete(service);
			await service.stop?.(context);
		}
	};
	t.after(async () => {
		await stop();
		assert.deepEqual(errors, [], "Plugin watchers must stop without background failures");
	});
	return {
		events,
		stop,
		async start(directory?: string) {
			assert.ok(services.length, "The installed entry must register its inspection service");
			for (const service of services) {
				const context: OpenClawPluginServiceContext = {
					config: {},
					workspaceDir: directory,
					stateDir: directory ?? os.tmpdir(),
					logger: {
						info() {},
						warn() {},
						error(message) {
							errors.push(message);
						},
					},
					gatewayEvents: {
						emit(event, payload, options) {
							events.push({ event, payload, scope: options.scope });
						},
						onSessionsChanged: () => () => {},
					},
				};
				active.set(service, context);
				await service.start(context);
			}
		},
		async request(operation: string, params: Record<string, unknown> = {}): Promise<unknown> {
			const handler = handlers.get(`lobster-viewer.workflows.${operation}`);
			assert.ok(handler, `The installed entry must register the ${operation} operation`);
			const responses: unknown[] = [];
			await Reflect.apply(handler, undefined, [
				{
					params,
					respond(ok: boolean, payload: unknown, error?: unknown) {
						assert.equal(ok, true, JSON.stringify(error));
						// Match the serialization boundary of a successful Gateway response.
						responses.push(JSON.parse(JSON.stringify(payload)));
					},
				},
			]);
			assert.equal(responses.length, 1, "Each request must settle with exactly one response");
			return responses[0];
		},
	};
}

function failure(response: unknown): string {
	assert.ok(response !== null && typeof response === "object");
	assert.ok("ok" in response && response.ok === false);
	assert.ok("error" in response && typeof response.error === "string");
	return response.error;
}

test("built plugin serves workflow graphs and packaged sources through its registered RPCs", async (t) => {
	const runtime = host(t);
	const directory = await workspace(t);
	const source = `throw new Error('Inspection must not execute companion code');\n${"// source text\n".repeat(6000)}`;
	await writeFile(path.join(directory, "workflows", "scripts", "helper.js"), source);
	await runtime.start(directory);
	assert.deepEqual(runtime.events, [
		{ event: "workflows-changed", payload: {}, scope: "operator.read" },
	]);
	assert.partialDeepStrictEqual(await runtime.request("list"), {
		ok: true,
		result: { workflows: [{ id: workflowId, name: "Inspect me", source: "file" }] },
	});
	assert.partialDeepStrictEqual(await runtime.request("get", { id: workflowId }), {
		ok: true,
		result: {
			workflow: {
				id: workflowId,
				definition: { filename: "inspect.lobster", language: "yaml", text: definition },
				graph: { nodes: [{ id: "inspect", type: "run" }] },
			},
		},
	});
	assert.deepEqual(await runtime.request("files", { id: workflowId }), {
		ok: true,
		result: {
			defaultPath: "inspect.lobster",
			truncated: false,
			files: [
				{ path: "inspect.lobster", language: "yaml" },
				{ path: "scripts/helper.js", language: "javascript" },
			],
		},
	});
	assert.deepEqual(await runtime.request("file", { id: workflowId, path: "scripts/helper.js" }), {
		ok: true,
		result: { file: { path: "scripts/helper.js", language: "javascript", text: source } },
	});
	const builtin = "builtin:github.pr.monitor";
	const filename = "src/workflows/github_pr_monitor.ts";
	const text = await readFile(
		new URL("../../../src/workflows/github_pr_monitor.ts", import.meta.url),
		"utf8",
	);
	assert.partialDeepStrictEqual(await runtime.request("get", { id: builtin }), {
		ok: true,
		result: { workflow: { definition: { filename, language: "typescript", text } } },
	});
	assert.deepEqual(await runtime.request("file", { id: builtin, path: filename }), {
		ok: true,
		result: { file: { path: filename, language: "typescript", text } },
	});
});

test("registered RPCs reject malformed requests and keep filesystem errors private", async (t) => {
	const runtime = host(t);
	const directory = await workspace(t);
	const privateFile = path.join(directory, "private.js");
	await writeFile(privateFile, "private content that must not leave the workspace root");
	await symlink(privateFile, path.join(directory, "workflows", "linked.js"));
	await runtime.start(directory);
	for (const [operation, params] of [
		["list", { id: workflowId }],
		["get", {}],
		["files", { id: 42 }],
		["file", { id: workflowId, path: "inspect.lobster", extra: true }],
	] satisfies [string, Record<string, unknown>][]) {
		assert.match(
			failure(await runtime.request(operation, params)),
			/Select a workflow or a source file/,
		);
	}
	assert.match(
		failure(await runtime.request("file", { id: workflowId, path: "../private.js" })),
		/Invalid source path/,
	);
	assert.equal(
		failure(await runtime.request("file", { id: workflowId, path: "linked.js" })),
		"Could not read workflow.",
	);
});

test("service stop retires unfinished reads and restart selects the new workspace", async (t) => {
	const runtime = host(t);
	const first = await workspace(t, "First workspace");
	const second = await workspace(t, "Second workspace");
	assert.match(failure(await runtime.request("list")), /unavailable/);
	await runtime.start(first);
	const pending = runtime.request("get", { id: workflowId });
	await runtime.stop();
	assert.match(failure(await pending), /restarted/);
	assert.match(failure(await runtime.request("get", { id: workflowId })), /unavailable/);
	await runtime.start(second);
	assert.partialDeepStrictEqual(await runtime.request("get", { id: workflowId }), {
		ok: true,
		result: { workflow: { name: "Second workspace" } },
	});
	await runtime.stop();
	await assert.rejects(runtime.start(), /default agent workspace/);
	assert.match(failure(await runtime.request("list")), /unavailable/);
});
