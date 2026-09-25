import type { LobsterPageTarget } from "../../../openclaw/extensions/lobster/browser/view-context.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { LobsterWorkflowFileResult } from "../../../openclaw/extensions/lobster/workflow-types.js";
import { createDevelopmentHost } from "./mock-host.js";

function fixture() {
	const requests: Array<{
		method: "list" | "get" | "files" | "file";
		signal: AbortSignal;
		id?: string;
		path?: string;
	}> = [];
	const navigations: string[] = [];
	const owner = createDevelopmentHost({
		transport: {
			async list(signal) {
				requests.push({ method: "list", signal });
				return { workflows: [] };
			},
			async get(id, signal) {
				requests.push({ method: "get", signal, id });
				return { workflow: { id, name: "Example", source: "file" } };
			},
			async files(id, signal) {
				requests.push({ method: "files", signal, id });
				return {
					files: [{ path: "sample.yaml", language: "yaml" }],
					defaultPath: "sample.yaml",
					truncated: false,
				};
			},
			async file(id, path, signal) {
				requests.push({ method: "file", signal, id, path });
				return { file: { path, language: "javascript", text: "console.log('hello');" } };
			},
		},
		navigate: (href) => navigations.push(href),
	});
	const lifetime = new AbortController();
	const view = owner.createView(lifetime.signal);
	return { owner, lifetime, view, requests, navigations };
}

test("the mock starts disconnected and only forwards the four read-only workflow requests", async () => {
	const { owner, view, requests } = fixture();
	assert.equal(view.host.connection.connected, false);
	await assert.rejects(view.host.request("lobster.workflows.list"), /disconnected/);
	assert.equal(requests.length, 0);
	owner.setConnection(true);
	assert.deepEqual(await view.host.request("lobster.workflows.list"), { workflows: [] });
	assert.deepEqual(await view.host.request("lobster.workflows.get", { id: "file:abc" }), {
		workflow: { id: "file:abc", name: "Example", source: "file" },
	});
	assert.deepEqual(await view.host.request("lobster.workflows.files", { id: "file:abc" }), {
		files: [{ path: "sample.yaml", language: "yaml" }],
		defaultPath: "sample.yaml",
		truncated: false,
	});
	assert.deepEqual(
		await view.host.request("lobster.workflows.file", { id: "file:abc", path: "scripts/hello.js" }),
		{
			file: { path: "scripts/hello.js", language: "javascript", text: "console.log('hello');" },
		},
	);
	assert.deepEqual(
		requests.map(({ method, id }) => ({ method, id })),
		[
			{ method: "list", id: undefined },
			{ method: "get", id: "file:abc" },
			{ method: "files", id: "file:abc" },
			{ method: "file", id: "file:abc" },
		],
	);
	assert.equal(
		requests.every(({ signal }) => !signal.aborted),
		true,
	);
	owner.dispose();
	assert.equal(
		requests.every(({ signal }) => signal.aborted),
		true,
	);
});

test("unsupported host calls and unexpected parameters cannot reach transport or navigation", async () => {
	const { owner, view, requests, navigations } = fixture();
	owner.setConnection(true);
	for (const [method, params] of [
		["sessions.create", {}],
		["lobster.workflows.run", { id: "file:abc" }],
		["lobster.workflows.list", { agentId: "main" }],
		["lobster.workflows.get", {}],
		["lobster.workflows.get", { id: "  " }],
		["lobster.workflows.get", { id: 3 }],
		["lobster.workflows.get", { id: "file:abc", run: true }],
		["lobster.workflows.files", {}],
		["lobster.workflows.files", { id: "file:abc", path: "other.js" }],
		["lobster.workflows.file", { id: "file:abc" }],
		["lobster.workflows.file", { id: "file:abc", path: "" }],
		["lobster.workflows.file", { id: "file:abc", path: 3 }],
		["lobster.workflows.file", { id: "file:abc", path: "sample.js", run: true }],
	] as const) {
		await assert.rejects(view.host.request(method, params), /development/);
	}
	assert.throws(() => view.host.onEvent("chat", () => {}), /not supported/);
	const unsupportedPages: LobsterPageTarget[] = [
		{ id: "automations" },
		{ id: "workflow" },
		{ id: "workflow", params: { workflowId: "" } },
		{ id: "workflow", params: { workflowId: "file:abc", run: "yes" } },
		{ id: "workflows", params: { agentId: "main" } },
	];
	for (const target of unsupportedPages) {
		assert.throws(() => view.host.navigation.openPage(target), /development/);
	}
	assert.deepEqual(requests, []);
	assert.deepEqual(navigations, []);
	owner.dispose();
});

test("navigation remains local and preserves the exact workflow id", () => {
	const { owner, view, navigations } = fixture();
	const id = "file:a/b?token=not-a-token#value";
	const target = { id: "workflow", params: { workflowId: id } };
	assert.equal(view.host.navigation.pageHref({ id: "workflows" }), "/");
	assert.equal(view.host.navigation.pageHref(target), `/workflow?id=${encodeURIComponent(id)}`);
	view.host.navigation.openPage(target);
	view.host.navigation.openPage({ id: "workflows" });
	assert.deepEqual(navigations, [`/workflow?id=${encodeURIComponent(id)}`, "/"]);
	owner.dispose();
});

test("connection changes, reconnects, and file events reach live subscriptions only", () => {
	const { owner, view, lifetime } = fixture();
	const connections: boolean[] = [];
	const changes: unknown[] = [];
	const unsubscribe = view.host.subscribe(() => connections.push(view.host.connection.connected));
	const stopEvents = view.host.onEvent("plugin.lobster.workflows-changed", (event) =>
		changes.push(event),
	);
	owner.setConnection(true);
	owner.setConnection(true);
	owner.emitWorkflowsChanged();
	owner.setConnection(false);
	owner.setConnection(true);
	owner.emitWorkflowsChanged();
	assert.deepEqual(connections, [true, false, true]);
	assert.deepEqual(changes, [{}, {}]);
	stopEvents();
	unsubscribe();
	owner.notify();
	owner.emitWorkflowsChanged();
	assert.equal(connections.length, 3);
	assert.equal(changes.length, 2);
	view.host.subscribe(() => assert.fail("Aborted subscription called"));
	view.host.onEvent("plugin.lobster.workflows-changed", () => assert.fail("Aborted event called"));
	lifetime.abort();
	owner.setConnection(false);
	owner.notify();
	owner.emitWorkflowsChanged();
	owner.dispose();
});

test("navigation aborts pending source reads and rejects late results, even if transport ignores cancellation", async () => {
	let complete!: (result: LobsterWorkflowFileResult) => void;
	let transportSignal: AbortSignal | undefined;
	const owner = createDevelopmentHost({
		transport: {
			file(_id, _path, signal) {
				transportSignal = signal;
				return new Promise((resolve) => {
					complete = resolve;
				});
			},
			async get() {
				throw new Error("Unexpected request");
			},
			async files() {
				throw new Error("Unexpected request");
			},
			async list() {
				throw new Error("Unexpected request");
			},
		},
		navigate: () => {},
	});
	const lifetime = new AbortController();
	const { host } = owner.createView(lifetime.signal);
	owner.setConnection(true);
	const pending = host.request("lobster.workflows.file", { id: "file:abc", path: "script.js" });
	lifetime.abort();
	assert.equal(transportSignal?.aborted, true);
	complete({ file: { path: "script.js", language: "javascript", text: "late result" } });
	await assert.rejects(pending, { name: "AbortError" });
	await assert.rejects(host.request("lobster.workflows.list"), { name: "AbortError" });
	assert.throws(() => host.navigation.openPage({ id: "workflows" }), { name: "AbortError" });
	assert.throws(() => host.subscribe(() => {}), { name: "AbortError" });
	assert.throws(() => host.onEvent("plugin.lobster.workflows-changed", () => {}), {
		name: "AbortError",
	});
	owner.dispose();
});

test("disposing a view revokes its host without disturbing another live view", async () => {
	const { owner, view } = fixture();
	const second = owner.createView(new AbortController().signal);
	let notifications = 0;
	view.host.subscribe(() => assert.fail("Disposed view notified"));
	second.host.subscribe(() => notifications++);
	view.dispose();
	view.dispose();
	owner.setConnection(true);
	assert.equal(notifications, 1);
	await assert.rejects(view.host.request("lobster.workflows.list"), { name: "AbortError" });
	assert.deepEqual(await second.host.request("lobster.workflows.list"), { workflows: [] });
	owner.dispose();
	owner.notify();
	owner.emitWorkflowsChanged();
	assert.equal(notifications, 1);
	assert.throws(() => second.host.connection.connected, { name: "AbortError" });
	assert.throws(() => owner.createView(new AbortController().signal), { name: "AbortError" });
});

test("the development redactor masks untrusted details and preserves actionable mock-owned errors", async () => {
	const { owner, view } = fixture();
	const source = "Authorization: Bearer synthetic-private-detail";
	const redacted = view.host.redact(source);
	assert.equal(redacted.includes(source), false);
	assert.equal(redacted.includes("synthetic-private-detail"), false);
	assert.match(redacted, /Details are hidden/);
	await assert.rejects(view.host.request("lobster.workflows.list"), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.equal(view.host.redact(error.message), error.message);
		assert.match(error.message, /Check that it is running/);
		return true;
	});
	owner.dispose();
});
