import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobsterWorkflowDetail, LobsterWorkflowResult } from "../workflow-types.js";
import { mountWorkflow } from "./index.js";
import {
	WorkflowViewError,
	workflowErrorMessage,
	type LobsterDialogProps,
	type LobsterViewContext,
} from "./view-context.js";

const cleanups: Array<() => void> = [];
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	// Browser proof covers geometry; this suite exercises real card/view request lifetimes.
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(async () => {
	await act(async () => cleanups.splice(0).forEach((dispose) => dispose()));
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

function workflow(filename: string, child?: string): LobsterWorkflowDetail {
	return {
		id: `file:${btoa(filename).replaceAll("=", "")}`,
		name: filename,
		source: "file",
		definition: { filename, language: "yaml", text: `name: ${filename}` },
		graph: {
			nodes: [
				{
					id: child ? "child" : "greet",
					type: child ? "workflow" : "run",
					label: "Example",
					shape: "box",
				},
			],
			edges: [],
		},
		steps: [
			{
				id: child ? "child" : "greet",
				...(child ? { workflow: child } : { command: "echo hello" }),
			},
		],
	};
}

async function fixture(child = "nested/child.lobster") {
	const parent = workflow("parent.lobster", child);
	const children = new Map<string, LobsterWorkflowDetail>();
	children.set(parent.id, parent);
	const controller = new AbortController();
	const container = document.createElement("div");
	document.body.append(container);
	const events = new Set<() => void>();
	const subscriptions = new Set<() => void>();
	const dialogs: Array<{ props: LobsterDialogProps; element: HTMLElement; dispose: () => void }> =
		[];
	const detailFor = (id: string) => {
		const detail = children.get(id);
		if (!detail) throw new WorkflowViewError("Workflow file is unavailable");
		return detail;
	};
	const get = vi.fn(async (id: string): Promise<LobsterWorkflowResult> => ({
		workflow: detailFor(id),
	}));
	const host: LobsterViewContext["host"] = {
		connection: { connected: true },
		workflows: {
			get,
			async list() {
				return { workflows: [...children.values()] };
			},
			async files(id) {
				const definition = detailFor(id).definition!;
				return {
					files: [{ path: definition.filename, language: definition.language }],
					defaultPath: definition.filename,
					truncated: false,
				};
			},
			async file(id, path) {
				const definition = detailFor(id).definition!;
				return { file: { path, language: definition.language, text: definition.text } };
			},
		},
		errorMessage: workflowErrorMessage,
		navigation: { pageHref: () => "/", openPage: vi.fn() },
		subscribe(listener) {
			subscriptions.add(listener);
			return () => {
				subscriptions.delete(listener);
			};
		},
		onWorkflowsChanged(listener) {
			events.add(listener);
			return () => {
				events.delete(listener);
			};
		},
		components: {
			mountDialog(target, props) {
				const element = document.createElement("section");
				element.setAttribute("role", "dialog");
				element.append(props.content);
				target.append(element);
				const dispose = vi.fn(() => element.remove());
				dialogs.push({ props, element, dispose });
				return { update: () => {}, dispose };
			},
		},
	};
	const context = {
		host,
		signal: controller.signal,
		props: { workflowId: parent.id },
		presented: true,
	};
	let view: ReturnType<typeof mountWorkflow>;
	await act(async () => {
		view = mountWorkflow(container, context);
	});
	cleanups.push(() => controller.abort());
	return {
		container,
		context,
		get,
		children,
		dialogs,
		controller,
		events,
		subscriptions,
		add(detail: LobsterWorkflowDetail) {
			children.set(detail.id, detail);
		},
		async open(scope: HTMLElement = container, keyboard = false) {
			const card = scope.querySelector<HTMLElement>('[aria-label="Open subworkflow child"]')!;
			expect(card).not.toBeNull();
			await act(async () => {
				if (keyboard) {
					card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
				} else {
					card.click();
				}
			});
			return card;
		},
		async change() {
			await act(async () => events.forEach((listener) => listener()));
		},
		async update() {
			await act(async () => view?.update?.(context));
		},
	};
}

describe("subworkflow dialog", () => {
	it("opens the referenced child from the actual card, preserves the parent, and releases child subscriptions", async () => {
		const f = await fixture();
		const child = workflow("nested/child.lobster");
		f.add(child);
		const parentCanvas = f.container.querySelector(".react-flow");
		const trigger = await f.open();
		expect(f.get).toHaveBeenLastCalledWith(child.id);
		const dialog = f.dialogs[0]!;
		expect(dialog.props.returnFocusTarget).toBe(trigger);
		expect(dialog.element.querySelector(".lobster-graph__step--run")?.textContent).toContain(
			"greet",
		);
		expect(f.container.querySelector(".react-flow")).toBe(parentCanvas);
		expect(f.context.host.navigation.openPage).not.toHaveBeenCalled();
		expect(f.events.size).toBe(2);
		expect(f.subscriptions.size).toBe(2);
		await act(async () =>
			dialog.element.querySelector<HTMLButtonElement>('[aria-label="Close subworkflow"]')!.click(),
		);
		expect(dialog.dispose).toHaveBeenCalledTimes(1);
		expect(f.events.size).toBe(1);
		expect(f.subscriptions.size).toBe(1);
		expect(f.container.querySelector(".react-flow")).toBe(parentCanvas);
	});

	it("supports keyboard entry and nested relative children, then retires all dialogs on navigation", async () => {
		const f = await fixture();
		f.add(workflow("nested/child.lobster", "../grandchild.yaml"));
		const grandchild = workflow("grandchild.yaml");
		f.add(grandchild);
		await f.open(f.container, true);
		await f.open(f.dialogs[0]!.element);
		expect(f.get).toHaveBeenLastCalledWith(grandchild.id);
		expect(f.events.size).toBe(3);
		f.context.props = { workflowId: grandchild.id };
		await f.update();
		expect(f.container.querySelector('[role="dialog"]')).toBeNull();
		expect(f.events.size).toBe(1);
		expect(f.dialogs.every((dialog) => vi.mocked(dialog.dispose).mock.calls.length === 1)).toBe(
			true,
		);
	});

	it("ignores an unfinished child response after cancellation and cleans up on abort", async () => {
		const f = await fixture();
		let complete!: (value: LobsterWorkflowResult) => void;
		const pending = new Promise<LobsterWorkflowResult>((resolve) => {
			complete = resolve;
		});
		f.get.mockReturnValueOnce(pending);
		await f.open();
		const dialog = f.dialogs[0]!;
		await act(async () => dialog.props.onCancel());
		await act(async () => complete({ workflow: workflow("nested/child.lobster") }));
		expect(dialog.element.querySelector(".lobster-graph")).toBeNull();
		expect(f.events.size).toBe(1);
		expect(f.subscriptions.size).toBe(1);
		await act(async () => f.controller.abort());
		expect(f.events.size).toBe(0);
		expect(f.subscriptions.size).toBe(0);
		expect(f.container.childElementCount).toBe(0);
	});

	it("shows missing-child errors in the dialog and recovers when the file arrives", async () => {
		const f = await fixture();
		await f.open();
		const dialog = f.dialogs[0]!;
		expect(dialog.element.querySelector('[role="alert"]')?.textContent).toContain(
			"Workflow file is unavailable",
		);
		const child = workflow("nested/child.lobster");
		f.add(child);
		await f.change();
		expect(dialog.element.querySelector("h1")?.textContent).toBe(child.name);
		expect(dialog.element.querySelector(".lobster-graph__step--run")).not.toBeNull();
		const updatedTrigger = f.container.querySelector<HTMLElement>(
			'[aria-label="Open subworkflow child"]',
		)!;
		await act(async () =>
			dialog.element.querySelector<HTMLButtonElement>('[aria-label="Close subworkflow"]')!.click(),
		);
		expect(dialog.dispose).toHaveBeenCalledTimes(1);
		expect(f.events.size).toBe(1);
		expect(document.activeElement).toBe(updatedTrigger);
	});

	it("shows an unresolved-target message without making a child request", async () => {
		const f = await fixture("${target}.lobster");
		await f.open();
		expect(f.dialogs[0]!.element.querySelector('[role="alert"]')?.textContent).toMatch(
			/dynamic|runtime|template/i,
		);
		expect(f.get).toHaveBeenCalledTimes(1);
		await act(async () =>
			f.dialogs[0]!.element.querySelector<HTMLButtonElement>("button")!.click(),
		);
		expect(f.container.querySelector('[role="dialog"]')).toBeNull();
	});
});
