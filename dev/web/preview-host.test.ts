import type { LobsterPageTarget, LobsterHostTheme } from "@lobster/ui/view-context";
import assert from "node:assert/strict";
import test from "node:test";
import type { LobsterWorkflowFileResult } from "@lobster/ui/workflow-types";
import { createDevelopmentHost, readPreview } from "./preview-host.js";

function fixture(theme: LobsterHostTheme = { colorMode: "light", subscribe: () => () => {} }) {
	const requests: Array<{
		method: "list" | "get" | "files" | "file";
		signal: AbortSignal;
		id?: string;
		path?: string;
	}> = [];
	const navigations: string[] = [];
	const owner = createDevelopmentHost({
		theme,
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

test("theme subscriptions are retired exactly once across view abort and consumer disposal", () => {
	const listeners = new Set<() => void>();
	let colorMode: "light" | "dark" = "light";
	let releases = 0;
	const f = fixture({
		get colorMode() {
			return colorMode;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				releases++;
				listeners.delete(listener);
			};
		},
	});
	const modes: string[] = [];
	const stop = f.view.host.theme.subscribe(() => modes.push(f.view.host.theme.colorMode));
	colorMode = "dark";
	for (const listener of listeners) listener();
	assert.deepEqual(modes, ["dark"]);
	f.lifetime.abort();
	stop();
	stop();
	f.owner.dispose();
	assert.equal(releases, 1);
	assert.equal(listeners.size, 0);
	assert.throws(() => f.view.host.theme.subscribe(() => {}), { name: "AbortError" });
});

test("the adapter starts disconnected and forwards typed workflow reads", async () => {
	const { owner, view, requests } = fixture();
	assert.equal(view.host.connection.connected, false);
	await assert.rejects(view.host.workflows.list(), /disconnected/);
	assert.equal(requests.length, 0);
	owner.setConnection(true);
	assert.deepEqual(await view.host.workflows.list(), { workflows: [] });
	assert.deepEqual(await view.host.workflows.get("file:abc"), {
		workflow: { id: "file:abc", name: "Example", source: "file" },
	});
	assert.deepEqual(await view.host.workflows.files("file:abc"), {
		files: [{ path: "sample.yaml", language: "yaml" }],
		defaultPath: "sample.yaml",
		truncated: false,
	});
	assert.deepEqual(await view.host.workflows.file("file:abc", "scripts/hello.js"), {
		file: { path: "scripts/hello.js", language: "javascript", text: "console.log('hello');" },
	});
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

test("invalid workflow ids, source paths and page targets never reach transport or navigation", async () => {
	const { owner, view, requests, navigations } = fixture();
	owner.setConnection(true);
	for (const read of [
		() => view.host.workflows.get("  "),
		() => view.host.workflows.files(""),
		() => view.host.workflows.file("file:abc", ""),
	]) {
		await assert.rejects(read(), /Select a workflow/);
	}
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
	let changes = 0;
	const unsubscribe = view.host.subscribe(() => connections.push(view.host.connection.connected));
	const stopEvents = view.host.onWorkflowsChanged(() => changes++);
	owner.setConnection(true);
	owner.setConnection(true);
	owner.emitWorkflowsChanged();
	owner.setConnection(false);
	owner.setConnection(true);
	owner.emitWorkflowsChanged();
	assert.deepEqual(connections, [true, false, true]);
	assert.equal(changes, 2);
	stopEvents();
	unsubscribe();
	owner.notify();
	owner.emitWorkflowsChanged();
	assert.equal(connections.length, 3);
	assert.equal(changes, 2);
	view.host.subscribe(() => assert.fail("Aborted subscription called"));
	view.host.onWorkflowsChanged(() => assert.fail("Aborted event called"));
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
		theme: { colorMode: "light", subscribe: () => () => {} },
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
	const pending = host.workflows.file("file:abc", "script.js");
	lifetime.abort();
	assert.equal(transportSignal?.aborted, true);
	complete({ file: { path: "script.js", language: "javascript", text: "late result" } });
	await assert.rejects(pending, { name: "AbortError" });
	await assert.rejects(host.workflows.list(), { name: "AbortError" });
	assert.throws(() => host.navigation.openPage({ id: "workflows" }), { name: "AbortError" });
	assert.throws(() => host.subscribe(() => {}), { name: "AbortError" });
	assert.throws(() => host.onWorkflowsChanged(() => {}), {
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
	await assert.rejects(view.host.workflows.list(), { name: "AbortError" });
	assert.deepEqual(await second.host.workflows.list(), { workflows: [] });
	owner.dispose();
	owner.notify();
	owner.emitWorkflowsChanged();
	assert.equal(notifications, 1);
	assert.throws(() => second.host.connection.connected, { name: "AbortError" });
	assert.throws(() => owner.createView(new AbortController().signal), { name: "AbortError" });
});

test("known workflow API errors stay actionable and unknown failures do not expose details", async (t) => {
	const { owner, view } = fixture();
	const safeMessage = "Workflow catalog exceeds 100 workflow files. Narrow the workspace.";
	const privateMessage = "Authorization: Bearer synthetic-private-detail";
	let body: unknown = { error: { type: "workflow", message: safeMessage } };
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response(JSON.stringify(body), { status: 400 }),
	);
	await assert.rejects(
		readPreview("http://localhost/api/workflows", new AbortController().signal),
		(error: unknown) => {
			assert.equal(view.host.errorMessage(error), safeMessage);
			return true;
		},
	);
	for (const unknown of [
		{ error: privateMessage },
		{ error: { type: "internal", message: privateMessage } },
		{ error: { type: "workflow", message: { secret: privateMessage } } },
	]) {
		body = unknown;
		await assert.rejects(
			readPreview("http://localhost/api/workflows", new AbortController().signal),
			(error: unknown) => {
				assert.equal(view.host.errorMessage(error).includes(privateMessage), false);
				assert.match(view.host.errorMessage(error), /Check the development server/);
				return true;
			},
		);
	}
	assert.equal(view.host.errorMessage(new Error(privateMessage)).includes(privateMessage), false);
	await assert.rejects(view.host.workflows.list(), (error: unknown) => {
		assert.match(view.host.errorMessage(error), /Check that it is running/);
		return true;
	});
	owner.dispose();
});
