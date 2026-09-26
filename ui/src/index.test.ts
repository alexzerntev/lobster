import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
	LobsterWorkflowsResult,
	LobsterWorkflowFileResult,
	LobsterWorkflowResult,
	LobsterSourceLanguage,
	LobsterSourceFile,
} from "../workflow-types.js";
import { createViewFixture, mockSource } from "./index.test-support.js";
import { WorkflowViewError } from "./workflow-errors.js";

describe("Lobster workflow page", () => {
	it("loads more matching workflows and preserves the visible limit across file changes", async () => {
		const fixture = await createViewFixture();
		const workflows: LobsterWorkflowsResult["workflows"] = Array.from({ length: 41 }, (_, i) => ({
			id: `file:${i + 1}`,
			name: `Workflow ${i + 1}`,
			description: i >= 20 ? "Matches search" : "Other",
			source: "file",
		}));
		fixture.list.mockResolvedValueOnce({ workflows });
		fixture.mount();
		await Promise.resolve();
		const more = () => fixture.container.querySelector<HTMLButtonElement>("button");
		const count = () => fixture.container.querySelector(".lobster-workflows__count")?.textContent;
		const names = () =>
			Array.from(fixture.container.querySelectorAll("li a"), (link) => link.textContent);
		expect(names()).toHaveLength(20);
		expect(count()).toBe("20 of 41");
		expect(more()?.textContent).toBe("Load more");
		const firstBatch = names();
		more()!.focus();
		more()!.click();
		expect(document.activeElement).toBe(more());
		expect(count()).toBe("40 of 41");
		expect(names().slice(0, 20)).toEqual(firstBatch);
		expect(names()).toHaveLength(40);
		fixture.list.mockResolvedValueOnce({ workflows });
		await act(async () => fixture.changed());
		expect(count()).toBe("40 of 41");
		more()!.click();
		expect(count()).toBe("41 of 41");
		expect(names()).toHaveLength(41);
		expect(more()).toBeNull();
		fixture.list.mockResolvedValueOnce({ workflows: workflows.slice(0, 40) });
		await act(async () => fixture.changed());
		expect(count()).toBe("40 of 40");
		expect(more()).toBeNull();

		const search = fixture.container.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = "matches search";
		search.dispatchEvent(new Event("input"));
		expect(count()).toBe("20 of 20");
		expect(names()[0]).toContain("Workflow 21");
		expect(more()).toBeNull();
		search.value = "missing";
		search.dispatchEvent(new Event("input"));
		expect(count()).toBe("0 of 0");
		expect(names()).toHaveLength(0);
		expect(more()).toBeNull();
		search.value = "";
		search.dispatchEvent(new Event("input"));
		expect(count()).toBe("20 of 40");
		expect(more()?.textContent).toBe("Load more");
		expect(fixture.list).toHaveBeenCalledTimes(3);
	});

	it("coalesces filesystem events, catches edits during refresh, and releases its subscription", async () => {
		const fixture = await createViewFixture();
		fixture.list.mockResolvedValueOnce({ workflows: [] });
		fixture.mount();
		await Promise.resolve();
		const search = fixture.container.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = "Latest";
		search.dispatchEvent(new Event("input"));
		const pending = Promise.withResolvers<LobsterWorkflowsResult>();
		fixture.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
			workflows: [{ id: "file:latest", name: "Latest version", source: "file" }],
		});
		fixture.changed();
		fixture.changed();
		await Promise.resolve();
		expect(fixture.list).toHaveBeenCalledTimes(2);
		fixture.changed();
		fixture.changed();
		expect(fixture.list).toHaveBeenCalledTimes(2);
		pending.resolve({ workflows: [] });
		// Drain the request and the single queued refresh; no elapsed-time dependency.
		await pending.promise;
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(fixture.list).toHaveBeenCalledTimes(3);
		expect(fixture.container.querySelector("li")?.textContent).toContain("Latest version");
		expect(search.value).toBe("Latest");
		fixture.changed();
		fixture.abort.abort();
		await Promise.resolve();
		expect(fixture.events.size).toBe(0);
		expect(fixture.list).toHaveBeenCalledTimes(3);
		expect(fixture.container.childElementCount).toBe(0);
	});

	it("defers hidden-view updates and catches up when the view is presented again", async () => {
		const fixture = await createViewFixture();
		fixture.list.mockResolvedValueOnce({ workflows: [] });
		fixture.mount();
		await Promise.resolve();
		fixture.present(false);
		fixture.changed();
		fixture.changed();
		await Promise.resolve();
		expect(fixture.list).toHaveBeenCalledTimes(1);
		fixture.list.mockResolvedValueOnce({
			workflows: [{ id: "file:new", name: "Created while hidden", source: "file" }],
		});
		fixture.present(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(fixture.list).toHaveBeenCalledTimes(2);
		expect(fixture.container.querySelector("li")?.textContent).toContain("Created while hidden");
	});

	it("updates the open definition while preserving Code selection", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:live");
		const detail = (text: string): LobsterWorkflowResult => ({
			workflow: {
				id: "file:live",
				name: "Live",
				source: "file",
				graph: { nodes: [{ id: "hello", type: "run", label: "hello", shape: "box" }], edges: [] },
				definition: { filename: "live.lobster", language: "yaml", text },
			},
		});
		fixture.get.mockResolvedValueOnce(detail("name: before"));
		await act(async () => fixture.mount());
		const codeButton = Array.from(fixture.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Code",
		)!;
		mockSource(fixture, "live.lobster", "name: before");
		await act(async () => codeButton.click());
		fixture.get.mockResolvedValueOnce(detail("name: after"));
		mockSource(fixture, "live.lobster", "name: after");
		await act(async () => fixture.changed());
		expect(codeButton.getAttribute("aria-pressed")).toBe("true");
		expect(fixture.container.querySelector("pre")?.textContent).toBe("name: after");
		expect(fixture.container.querySelector<HTMLElement>(".lobster-graph__code-view")?.hidden).toBe(
			false,
		);
		await act(async () => fixture.abort.abort());
		expect(fixture.events.size).toBe(0);
	});

	it("mounts the workflow list and keeps filtering across filesystem updates", async () => {
		const fixture = await createViewFixture();
		const pending = Promise.withResolvers<LobsterWorkflowsResult>();
		fixture.list.mockReturnValueOnce(pending.promise);
		fixture.mount();
		expect(fixture.container.textContent).toContain("Loading workflows");
		expect(fixture.list).toHaveBeenCalledWith();
		pending.resolve({
			workflows: [
				{
					id: "file:example",
					name: "<b>example</b>",
					description: "A workflow with <em>details</em>.",
					source: "file",
				},
				{ id: "builtin:second", name: "No description", source: "builtin" },
			],
		});
		await pending.promise;
		const rows = fixture.container.querySelectorAll("li");
		expect(rows[0]?.textContent).toContain("<b>example</b>");
		expect(rows[0]?.textContent).toContain("A workflow with <em>details</em>.");
		expect(rows[1]?.textContent).toContain("No description");
		expect(fixture.container.querySelector("b, em")).toBeNull();
		const link = rows[0]?.querySelector("a");
		expect(link?.href).toContain("id=file%3Aexample");
		link?.click();
		expect(fixture.openPage).toHaveBeenCalledWith({
			id: "workflow",
			params: { workflowId: "file:example" },
		});

		const search = fixture.container.querySelector<HTMLInputElement>('input[type="search"]')!;
		const filter = (value: string) => {
			search.value = value;
			search.dispatchEvent(new Event("input"));
		};
		filter("  DETAILS  ");
		expect(fixture.container.querySelectorAll("li")).toHaveLength(1);
		expect(fixture.container.querySelector("li")?.textContent).toContain("<b>example</b>");
		filter("No description");
		expect(fixture.container.querySelectorAll("li")).toHaveLength(1);
		expect(fixture.container.querySelector("li")?.textContent).toContain("No description");
		filter("missing");
		expect(fixture.container.querySelector("li")).toBeNull();
		expect(fixture.container.textContent).toContain("No matching workflows.");
		filter("");
		expect(fixture.container.querySelectorAll("li")).toHaveLength(2);
		expect(fixture.list).toHaveBeenCalledTimes(1);

		filter("new result");
		const updated = Promise.resolve<LobsterWorkflowsResult>({
			workflows: [
				{ id: "file:new", name: "New result", source: "file" },
				{ id: "file:other", name: "Other", source: "file" },
			],
		});
		fixture.list.mockReturnValueOnce(updated);
		await act(async () => fixture.changed());
		await updated;
		expect(search.value).toBe("new result");
		expect(fixture.container.querySelectorAll("li")).toHaveLength(1);
		expect(fixture.container.querySelector("li")?.textContent).toContain("New result");

		const empty = Promise.resolve({ workflows: [] });
		fixture.list.mockReturnValueOnce(empty);
		await act(async () => fixture.changed());
		await empty;
		expect(fixture.container.querySelector("li")).toBeNull();
		expect(fixture.container.textContent).toContain("No workflows available.");
	});

	it("browses nested sources, ignores late reads, and preserves selection across disk changes", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:source");
		const slow = Promise.withResolvers<LobsterWorkflowFileResult>();
		const sources = new Map<string, { language: LobsterSourceLanguage; text: string }>([
			["main.lobster", { language: "yaml", text: "steps: []" }],
			["scripts/slow.js", { language: "javascript", text: "// slow" }],
			["scripts/run.js", { language: "javascript", text: 'export const value = "<img src=x>";' }],
		]);
		fixture.get.mockResolvedValue({
			workflow: {
				id: "file:source",
				name: "Source",
				source: "file",
				graph: { nodes: [], edges: [] },
			},
		});
		fixture.files.mockImplementation(async () => ({
			files: [...sources].map(([path, file]) => ({ path, language: file.language })),
			defaultPath: "main.lobster",
			truncated: false,
		}));
		fixture.file.mockImplementation(async (_id, path) => {
			if (path === "scripts/slow.js") return slow.promise;
			return { file: { path, ...sources.get(path)! } };
		});
		await act(async () => fixture.mount());
		const select = (path: string) =>
			fixture.container.querySelector<HTMLButtonElement>(`button[data-path="${path}"]`)!.click();
		expect(fixture.container.querySelector("pre")?.textContent).toBe("steps: []");
		expect(fixture.container.querySelector("details summary")?.textContent).toBe("scripts");
		await act(async () => select("scripts/slow.js"));
		await act(async () => select("scripts/run.js"));
		slow.resolve({
			file: { path: "scripts/slow.js", language: "javascript", text: "// retired result" },
		});
		await act(async () => {
			await slow.promise;
		});
		expect(fixture.container.querySelector("pre")?.textContent).toBe(
			'export const value = "<img src=x>";',
		);
		expect(fixture.container.querySelector("pre .hljs-keyword")?.textContent).toBe("export");
		expect(fixture.container.querySelector("img")).toBeNull();
		sources.set("scripts/run.js", { language: "javascript", text: "export const value = 2;" });
		await act(async () => fixture.changed());
		expect(
			fixture.container.querySelector('[aria-current="true"]')?.getAttribute("data-path"),
		).toBe("scripts/run.js");
		expect(fixture.container.querySelector("pre")?.textContent).toBe("export const value = 2;");
		sources.delete("scripts/run.js");
		await act(async () => fixture.changed());
		expect(fixture.container.querySelector("pre")?.textContent).toBe("");
		expect(fixture.container.textContent).toContain(
			"This file is no longer available. Select another file.",
		);
		await act(async () => fixture.abort.abort());
	});

	it("retires source reads on route changes and view disposal", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:first");
		const stale = Promise.withResolvers<LobsterWorkflowFileResult>();
		const retired = Promise.withResolvers<LobsterWorkflowFileResult>();
		fixture.get.mockResolvedValueOnce({
			workflow: { id: "file:first", source: "file", name: "First" },
		});
		fixture.files.mockResolvedValueOnce({
			files: [{ path: "first.yaml", language: "yaml" }],
			defaultPath: "first.yaml",
			truncated: false,
		});
		fixture.file.mockReturnValueOnce(stale.promise);
		await act(async () => fixture.mount());
		fixture.get.mockResolvedValueOnce({
			workflow: { id: "file:second", source: "file", name: "Second" },
		});
		mockSource(fixture, "second.yaml", "name: second");
		await act(async () => fixture.navigate("file:second"));
		stale.resolve({ file: { path: "first.yaml", language: "yaml", text: "name: first" } });
		await act(async () => {
			await stale.promise;
		});
		expect(fixture.container.querySelector("pre")?.textContent).toBe("name: second");
		fixture.file.mockReturnValueOnce(retired.promise);
		await act(async () =>
			fixture.container
				.querySelector<HTMLButtonElement>('button[data-path="second.yaml"]')!
				.click(),
		);
		await act(async () => fixture.abort.abort());
		retired.resolve({ file: { path: "second.yaml", language: "yaml", text: "name: retired" } });
		await act(async () => {
			await retired.promise;
		});
		expect(fixture.container.childElementCount).toBe(0);
		expect(fixture.events.size).toBe(0);
	});

	it("opens command, input and relative subworkflow references in Code without opening a child dialog", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:links");
		const command = 'node "scripts/task one.js" --config=workflows/scripts/options.json';
		const files: LobsterSourceFile[] = [
			{ path: "nested/main.lobster", language: "yaml" },
			{ path: "nested/child.lobster", language: "yaml" },
			{ path: "scripts/task one.js", language: "javascript" },
			{ path: "scripts/options.json", language: "json" },
		];
		fixture.get.mockResolvedValue({
			workflow: {
				id: "file:links",
				name: "Links",
				source: "file",
				definition: { filename: "nested/main.lobster", language: "yaml", text: "steps: []" },
				graph: {
					nodes: [
						{ id: "command", type: "run", label: "Command", shape: "box" },
						{ id: "child", type: "workflow", label: "Child", shape: "box" },
						{ id: "input", type: "input", label: "Input", shape: "box" },
					],
					edges: [],
				},
				steps: [
					{ id: "command", command },
					{ id: "child", workflow: "./child.lobster" },
					{
						id: "input",
						input: {
							prompt: "Select file",
							responseSchema: { type: "string", enum: ["scripts/options.json"] },
						},
					},
				],
			},
		});
		fixture.files.mockImplementation(async () => ({
			files,
			defaultPath: "nested/main.lobster",
			truncated: false,
		}));
		fixture.file.mockImplementation(async (_id, path) => ({
			file: { path, language: "plaintext", text: `Contents of ${path}` },
		}));
		await act(async () => fixture.mount());
		const flow = Array.from(fixture.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Flow",
		)!;
		const code = Array.from(fixture.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Code",
		)!;
		const open = async (selector: string, path: string) => {
			await act(async () => fixture.container.querySelector<HTMLButtonElement>(selector)!.click());
			expect(code.getAttribute("aria-pressed")).toBe("true");
			expect(
				fixture.container.querySelector('[aria-current="true"]')?.getAttribute("data-path"),
			).toBe(path);
			expect(fixture.container.querySelector("pre")?.textContent).toBe(`Contents of ${path}`);
			expect(document.activeElement).toBe(fixture.container.querySelector("pre"));
		};
		expect(fixture.container.querySelector("code.language-bash")?.textContent).toBe(command);
		expect(fixture.container.querySelector(".hljs-string")).not.toBeNull();
		await open('.react-flow__node [data-source-path="scripts/task one.js"]', "scripts/task one.js");
		const folder = Array.from(fixture.container.querySelectorAll("details")).find(
			(details) => details.querySelector("summary")?.textContent === "scripts",
		)!;
		folder.open = false;
		folder.dispatchEvent(new Event("toggle"));
		await act(async () => flow.click());
		await open('.lobster-input [data-source-path="scripts/options.json"]', "scripts/options.json");
		expect(
			Array.from(fixture.container.querySelectorAll("details")).find(
				(details) => details.querySelector("summary")?.textContent === "scripts",
			)?.open,
		).toBe(true);
		await act(async () => flow.click());
		await open(
			'[data-subworkflow-id="child"] [data-source-path="nested/child.lobster"]',
			"nested/child.lobster",
		);
		expect(fixture.container.querySelector("[role=dialog]")).toBeNull();
		files.splice(
			files.findIndex((file) => file.path === "scripts/options.json"),
			1,
		);
		await act(async () => fixture.changed());
		expect(fixture.container.querySelector('[data-source-path="scripts/options.json"]')).toBeNull();
		await act(async () => fixture.abort.abort());
	});

	it("recovers from a failed catalog read after a filesystem change", async () => {
		const fixture = await createViewFixture();
		const failed = Promise.reject(
			new WorkflowViewError("Workflow catalog exceeds 100 workflow files. Narrow the workspace."),
		);
		fixture.list.mockReturnValueOnce(failed);
		fixture.mount();
		await failed.catch(() => {});
		expect(fixture.container.querySelector('[role="alert"]')?.textContent).toContain(
			"100 workflow files",
		);
		const recovered = Promise.resolve<LobsterWorkflowsResult>({
			workflows: [{ id: "file:recovered", name: "recovered", source: "file" }],
		});
		fixture.list.mockReturnValueOnce(recovered);
		await act(async () => fixture.changed());
		await recovered;
		expect(fixture.container.querySelector('[role="alert"]')).toBeNull();
		expect(fixture.container.querySelector("li")?.textContent).toContain("recovered");
	});

	it("rejects stale results across reconnect and disposal", async () => {
		const fixture = await createViewFixture();
		const stale = Promise.withResolvers<LobsterWorkflowsResult>();
		fixture.list.mockReturnValueOnce(stale.promise);
		fixture.mount();
		fixture.connect(false);
		expect(fixture.container.textContent).toContain("Connect to the workflow server");
		const current = Promise.resolve<LobsterWorkflowsResult>({
			workflows: [{ id: "file:current", name: "current", source: "file" }],
		});
		fixture.list.mockReturnValueOnce(current);
		fixture.connect(true);
		await current;
		stale.resolve({ workflows: [{ id: "file:stale", name: "stale", source: "file" }] });
		await stale.promise;
		expect(fixture.container.querySelector("li")?.textContent).toContain("current");

		const retired = Promise.withResolvers<LobsterWorkflowsResult>();
		fixture.list.mockReturnValueOnce(retired.promise);
		fixture.changed();
		await Promise.resolve();
		fixture.abort.abort();
		retired.resolve({ workflows: [{ id: "file:retired", name: "retired", source: "file" }] });
		await retired.promise;
		expect(fixture.container.childElementCount).toBe(0);
	});

	it("renders every native node type and approval shape with safe, highlighted fields", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		// Geometry is covered in the browser; this exercises the public workflow view's actual cards.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:fields");
		const reviewStep = {
			id: "review",
			input: {
				prompt: "<em>Choose a value</em>",
				responseSchema: {
					type: "object",
					properties: {
						choice: { type: "string", enum: ["one", "<img src=x onerror=alert(1)>"] },
						count: { type: "integer" },
					},
					required: ["choice"],
				},
			},
			when: false,
			limit: 0,
			empty: "",
			unset: null,
		};
		fixture.get.mockResolvedValue({
			workflow: {
				id: "file:fields",
				name: "Fields",
				source: "file",
				steps: [
					reviewStep,
					{
						id: "group",
						parallel: {
							wait: "all",
							branches: [
								{ id: "branch-command", command: "printf 'branch'" },
								{ id: "branch-pipeline", pipeline: "json" },
							],
						},
						approval: true,
					},
					{ id: "execute", run: "printf '<img src=x onerror=alert(1)>'\necho \"$VALUE\"" },
					{ id: "process", pipeline: "head --n 1 | json", stdin: "$execute.json" },
					{ id: "child", workflow: "child.lobster", approval: true },
					{ id: "each", for_each: "$execute.json", steps: [{ id: "nested", run: "echo item" }] },
					{ id: "approve", approval: "Continue?" },
					// A graph node can still render when step metadata is absent.
				],
				graph: {
					nodes: [
						{ id: "review", type: "input", label: "review", shape: "box" },
						{ id: "group", type: "parallel", label: "group", shape: "diamond" },
						{ id: "execute", type: "run", label: "execute", shape: "diamond" },
						{ id: "process", type: "pipeline", label: "process", shape: "box" },
						{ id: "child", type: "workflow", label: "child", shape: "diamond" },
						{ id: "each", type: "for_each", label: "each", shape: "box" },
						{ id: "approve", type: "approval", label: "approve", shape: "diamond" },
						{ id: "generic", type: "step", label: "generic", shape: "box" },
					],
					edges: [
						{ from: "review", to: "group", label: "next" },
						{ from: "group", to: "execute", label: "next" },
						{ from: "execute", to: "process", label: "next" },
						{ from: "execute", to: "process", label: "stdin" },
						{ from: "process", to: "child", label: "next" },
						{ from: "child", to: "each", label: "next" },
						{ from: "each", to: "approve", label: "next" },
						{ from: "approve", to: "generic", label: "next" },
					],
				},
			},
		});
		await act(async () => fixture.mount());
		const nodes = fixture.container.querySelectorAll(".react-flow__node");
		expect(nodes).toHaveLength(12);
		expect(
			Array.from(nodes, (node) => node.querySelector(".lobster-graph__step-header")?.textContent),
		).toEqual([
			"reviewInput",
			"groupParallel",
			"branch-commandCommand",
			"branch-pipelinePipeline",
			"Wait for allJoin",
			"executeCommand",
			"processPipeline",
			"childSubworkflow",
			"eachLoop",
			"nestedCommand",
			"approveApproval",
			"genericStep",
		]);
		expect(
			Array.from(nodes, (node) => Boolean(node.querySelector(".lobster-graph__approval"))),
		).toEqual([false, false, false, false, true, true, false, true, false, false, true, false]);
		const values = Array.from(nodes[0]!.querySelectorAll("dt, dd"), (cell) => cell.textContent);
		expect(values).toEqual(["when", "false", "limit", "0", "empty", '""', "unset", "null"]);
		const input = nodes[0]!.querySelector(".lobster-input")!;
		expect(input.querySelector(".lobster-input__prompt")?.textContent).toBe(
			"<em>Choose a value</em>",
		);
		expect(
			Array.from(input.querySelectorAll(".lobster-input__type"), (tag) => tag.textContent),
		).toEqual(["string", "integer"]);
		expect(input.querySelectorAll(".lobster-input__required")).toHaveLength(1);
		expect(Array.from(input.querySelectorAll("li"), (option) => option.textContent)).toEqual([
			"one",
			"<img src=x onerror=alert(1)>",
		]);
		expect(input.textContent).toContain("Whole number");
		expect(input.querySelector("input, select, button")).toBeNull();
		expect(nodes[5]?.querySelector("dt")?.textContent).toBe("run");
		expect(nodes[5]?.textContent).toContain("◇ Approval required");
		expect(nodes[5]?.querySelector("dd")?.textContent).toBe(
			"printf '<img src=x onerror=alert(1)>'\necho \"$VALUE\"",
		);
		expect(nodes[5]?.querySelector(".hljs-built_in")?.textContent).toBe("printf");
		expect(nodes[5]?.querySelector(".hljs-variable")?.textContent).toBe("$VALUE");
		expect(Array.from(nodes[6]!.querySelectorAll("dt, dd"), (cell) => cell.textContent)).toEqual([
			"pipeline",
			"head --n 1 | json",
			"stdin",
			"$execute.json",
		]);
		expect(nodes[7]?.querySelector("dd")?.textContent).toBe("child.lobster");
		expect(nodes[8]?.querySelector("[data-loop-header]")).not.toBeNull();
		expect(nodes[8]?.textContent).not.toContain("- id: nested");
		expect(nodes[9]?.querySelector("code.language-bash")?.textContent).toBe("echo item");
		expect(nodes[9]?.querySelector(".hljs-built_in")?.textContent).toBe("echo");
		expect(nodes[10]?.querySelector("dd")?.textContent).toBe("Continue?");
		expect(nodes[11]?.querySelector("dd")).toBeNull();
		expect(nodes[2]?.querySelector(".hljs-built_in")?.textContent).toBe("printf");
		expect(nodes[3]?.querySelector("dd")?.textContent).toBe("json");
		expect(nodes[4]?.querySelector(".lobster-graph__step--join")).not.toBeNull();
		expect(Array.from(nodes[4]!.querySelectorAll("dt, dd"), (cell) => cell.textContent)).toEqual([
			"wait",
			"all",
			"parallel",
			"group",
			"approval",
			"true",
		]);
		expect(nodes[4]?.textContent).not.toContain("group::join");
		expect(fixture.container.querySelector("em, img")).toBeNull();
		await act(async () => fixture.abort.abort());
	});

	it("explains malformed parallel metadata and keeps the saved code available", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:invalid-parallel");
		fixture.get.mockResolvedValueOnce({
			workflow: {
				id: "file:invalid-parallel",
				name: "Invalid parallel",
				source: "file",
				steps: [{ id: "group", parallel: { branches: [] } }],
				graph: {
					nodes: [{ id: "group", type: "parallel", label: "group", shape: "box" }],
					edges: [],
				},
			},
		});
		mockSource(fixture, "invalid.yaml", "steps: []");
		await act(async () => fixture.mount());
		expect(fixture.container.querySelector('[role="alert"]')?.textContent).toContain(
			"Cannot visualize parallel step",
		);
		expect(fixture.container.querySelectorAll(".react-flow__node")).toHaveLength(0);
		const code = Array.from(fixture.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Code",
		)!;
		expect(code.disabled).toBe(false);
		await act(async () => code.click());
		expect(fixture.container.querySelector("pre")?.textContent).toBe("steps: []");
		await act(async () => fixture.abort.abort());
	});

	it("keeps the selected workflow when an earlier detail request finishes late", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		// jsdom has no layout observer; this case exercises route/request ownership, not geometry.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:first");
		const first = Promise.withResolvers<LobsterWorkflowResult>();
		fixture.get.mockReturnValueOnce(first.promise);
		await act(async () => fixture.mount());
		const second = Promise.resolve<LobsterWorkflowResult>({
			workflow: {
				id: "file:second",
				name: "Second",
				source: "file",
				steps: [{ id: "second", command: "echo second" }],
				graph: {
					nodes: [{ id: "second", type: "run", label: "second", shape: "box" }],
					edges: [],
				},
				definition: {
					filename: "second.yaml",
					language: "yaml",
					text: "# <em>Second</em>\nsteps:\n  - id: second\n    command: echo second\n",
				},
			},
		});
		fixture.get.mockReturnValueOnce(second);
		mockSource(
			fixture,
			"second.yaml",
			"# <em>Second</em>\nsteps:\n  - id: second\n    command: echo second\n",
		);
		await act(async () => fixture.navigate("file:second"));
		await second;
		first.resolve({ workflow: { id: "file:first", name: "First", source: "file", steps: [] } });
		await first.promise;
		expect(fixture.container.querySelector("h1")?.textContent).toBe("Second");
		const buttons = Array.from(fixture.container.querySelectorAll("button"));
		const codeButton = buttons.find((button) => button.textContent === "Code");
		const flowButton = buttons.find((button) => button.textContent === "Flow");
		await act(async () => codeButton?.click());
		expect(codeButton?.getAttribute("aria-pressed")).toBe("true");
		expect(fixture.container.querySelector("pre")?.textContent).toBe(
			"# <em>Second</em>\nsteps:\n  - id: second\n    command: echo second\n",
		);
		expect(fixture.container.querySelector("em")).toBeNull();
		expect(fixture.container.querySelector("pre .hljs-attr")?.textContent).toBe("steps:");
		expect(fixture.container.querySelector<HTMLElement>(".lobster-source__message")?.hidden).toBe(
			true,
		);
		flowButton?.click();
		expect(flowButton?.disabled).toBe(false);
		expect(flowButton?.getAttribute("aria-pressed")).toBe("true");
		expect(fixture.container.querySelector<HTMLElement>(".lobster-graph__code-view")?.hidden).toBe(
			true,
		);
		expect(fixture.get).toHaveBeenCalledTimes(2);
		expect(fixture.files).toHaveBeenCalledTimes(1);
		expect(fixture.file).toHaveBeenCalledTimes(1);
		const json = Promise.resolve<LobsterWorkflowResult>({
			workflow: {
				id: "file:json",
				name: "JSON",
				source: "file",
				steps: [],
				definition: {
					filename: "example.json",
					language: "json",
					text: '{"name":"<em>JSON</em>"}',
				},
			},
		});
		fixture.get.mockReturnValueOnce(json);
		mockSource(fixture, "example.json", '{"name":"<em>JSON</em>"}', "json");
		await act(async () => fixture.navigate("file:json"));
		await json;
		codeButton?.click();
		expect(fixture.container.querySelector("pre")?.textContent).toBe('{"name":"<em>JSON</em>"}');
		expect(fixture.container.querySelector("pre .hljs-attr")?.textContent).toBe('"name"');
		expect(fixture.container.querySelector("em")).toBeNull();
		fixture.container.querySelector("a")?.click();
		expect(fixture.openPage).toHaveBeenCalledWith({ id: "workflows" });
		await act(async () => fixture.abort.abort());
		expect(fixture.container.childElementCount).toBe(0);
	});

	it.each([true, false])(
		"shows a single built-in card with source availability %s",
		async (hasSource) => {
			vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
			vi.stubGlobal(
				"ResizeObserver",
				class {
					observe() {}
					unobserve() {}
					disconnect() {}
				},
			);
			const fixture = await createViewFixture("workflow", "builtin:example");
			const text = 'export function example() { return "done"; }';
			fixture.files.mockResolvedValue({
				files: [{ path: "example.js", language: "javascript" }],
				defaultPath: "example.js",
				truncated: false,
			});
			fixture.file.mockResolvedValue({
				file: { path: "example.js", language: "javascript", text },
			});
			fixture.get.mockResolvedValue({
				workflow: {
					id: "builtin:example",
					name: "example",
					source: "builtin",
					description: "A built-in with <em>details</em>.",
					...(hasSource
						? { definition: { filename: "example.js", language: "javascript", text } }
						: {}),
				},
			});
			await act(async () => fixture.mount());
			const nodes = fixture.container.querySelectorAll(".react-flow__node");
			expect(nodes).toHaveLength(1);
			expect(nodes[0]?.textContent).toContain("exampleBuilt-in");
			expect(nodes[0]?.textContent).toContain("A built-in with <em>details</em>.");
			expect(fixture.container.querySelector("em")).toBeNull();
			expect(fixture.container.querySelector(".react-flow__edge")).toBeNull();
			const buttons = Array.from(fixture.container.querySelectorAll("button"));
			const flow = buttons.find((button) => button.textContent === "Flow")!;
			const code = buttons.find((button) => button.textContent === "Code")!;
			expect(flow.disabled).toBe(false);
			expect(flow.getAttribute("aria-pressed")).toBe("true");
			expect(code.disabled).toBe(!hasSource);
			const codeView = fixture.container.querySelector<HTMLElement>(".lobster-graph__code-view")!;
			expect(codeView.hidden).toBe(true);
			if (hasSource) {
				expect(nodes[0]?.textContent).toContain("fileexample.js");
				expect(fixture.file).not.toHaveBeenCalled();
				await act(async () =>
					nodes[0]!.querySelector<HTMLButtonElement>("[data-source-path]")!.click(),
				);
				expect(codeView.hidden).toBe(false);
				expect(codeView.querySelector("pre")?.textContent).toBe(text);
				expect(codeView.querySelector('[aria-current="true"]')?.textContent).toBe("example.js");
				flow.click();
				expect(codeView.hidden).toBe(true);
			} else {
				expect(nodes[0]?.textContent).not.toContain("example.js");
			}
			await act(async () => fixture.abort.abort());
		},
	);

	it("handles code-only and rejected graphs and recovers when a valid graph loads", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		const fixture = await createViewFixture("workflow", "file:example");
		const text = 'export async function example() { return "<em>source</em>"; }';
		const loaded = Promise.resolve<LobsterWorkflowResult>({
			workflow: {
				id: "file:example",
				name: "Example",
				source: "file",
				definition: { filename: "example.js", language: "javascript", text },
				unavailableReason: "No step definition. Select Code to view its implementation.",
			},
		});
		fixture.get.mockReturnValueOnce(loaded);
		mockSource(fixture, "example.js", text, "javascript");
		await act(async () => fixture.mount());
		await loaded;
		const buttons = Array.from(fixture.container.querySelectorAll("button"));
		const codeButton = buttons.find((button) => button.textContent === "Code");
		const flowButton = buttons.find((button) => button.textContent === "Flow");
		const codeView = fixture.container.querySelector<HTMLElement>(".lobster-graph__code-view");
		expect(codeButton?.getAttribute("aria-pressed")).toBe("true");
		expect(codeView?.hidden).toBe(false);
		expect(fixture.container.querySelector("pre")?.textContent).toBe(text);
		expect(fixture.container.querySelector("pre .hljs-keyword")?.textContent).toBe("export");
		expect(fixture.container.querySelector("em")).toBeNull();
		expect(flowButton?.disabled).toBe(true);
		flowButton?.click();
		expect(codeView?.hidden).toBe(false);

		const rejected = Promise.resolve<LobsterWorkflowResult>({
			workflow: {
				id: "file:unsupported",
				name: "Unsupported graph",
				source: "file",
				unavailableReason: "Lobster returned an invalid workflow graph node",
			},
		});
		fixture.get.mockReturnValueOnce(rejected);
		mockSource(fixture, "unsupported.yaml", "steps: [broken", "yaml");
		await act(async () => fixture.navigate("file:unsupported"));
		await rejected;
		expect(flowButton?.disabled).toBe(true);
		expect(codeButton?.disabled).toBe(false);
		expect(fixture.container.querySelector(".react-flow__node")).toBeNull();
		expect(fixture.container.querySelector("pre")?.textContent).toBe("steps: [broken");

		const file = Promise.resolve<LobsterWorkflowResult>({
			workflow: {
				id: "file:example",
				name: "File",
				source: "file",
				steps: [{ id: "hello", command: "echo hello" }],
				graph: {
					nodes: [{ id: "hello", type: "run", label: "hello", shape: "box" }],
					edges: [],
				},
			},
		});
		fixture.get.mockReturnValueOnce(file);
		await act(async () => fixture.navigate("file:example"));
		await file;
		expect(flowButton?.getAttribute("aria-pressed")).toBe("true");
		expect(flowButton?.disabled).toBe(false);
		expect(fixture.container.querySelector("pre")?.textContent).toBe("");
		await act(async () => fixture.abort.abort());
	});
});
