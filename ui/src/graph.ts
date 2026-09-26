import {
	Background,
	BaseEdge,
	Controls,
	EdgeLabelRenderer,
	Handle,
	Position,
	ReactFlow,
	ReactFlowProvider,
	getViewportForBounds,
	useNodes,
	useNodesInitialized,
	useReactFlow,
	type EdgeProps,
	type NodeProps,
} from "@xyflow/react";
import {
	Fragment,
	createContext,
	createElement as h,
	memo,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { LobsterSourceFile, LobsterWorkflowDetail } from "../workflow-types.js";
import {
	graphFor,
	layoutWorkflowGraph,
	type WorkflowNode,
	type WorkflowEdge,
} from "./graph-layout.js";
import { WorkflowInputPreview } from "./input-preview.js";
import { createSourceExplorer } from "./source-explorer.js";
import { SourceLinksContext, SourceText } from "./source-links.js";
import { openSubworkflowDialog } from "./subworkflow-dialog.js";
import type { LobsterView, LobsterViewContext } from "./view-context.js";
import { subscribeWorkflowChanges } from "./workflow-changes.js";
import "@xyflow/react/dist/style.css";

const nodeLabels: Record<WorkflowNode["data"]["type"], string> = {
	run: "Command",
	pipeline: "Pipeline",
	workflow: "Subworkflow",
	parallel: "Parallel",
	join: "Join",
	for_each: "Loop",
	approval: "Approval",
	input: "Input",
	step: "Step",
	builtin: "Built-in",
};
const SubworkflowContext = createContext<((id: string, trigger: HTMLElement) => void) | null>(null);
const WorkflowNodeCard = memo(function WorkflowNodeCard({ id, data }: NodeProps<WorkflowNode>) {
	const { type, label, shape, fields } = data;
	const open = useContext(SubworkflowContext);
	const interactive = type === "workflow" && open !== null;
	const input = type === "input" ? fields.find((field) => field.name === "input") : undefined;
	return h(
		"div",
		{
			className: `lobster-graph__step lobster-graph__step--${type}${data.isContainer ? " lobster-graph__step--container" : ""}${interactive ? " lobster-graph__step--interactive nopan" : ""}`,
			title: label,
			role: interactive ? "button" : undefined,
			tabIndex: interactive ? 0 : undefined,
			"aria-label": interactive ? `Open subworkflow ${id}` : undefined,
			"aria-haspopup": interactive ? "dialog" : undefined,
			"data-subworkflow-id": interactive ? id : undefined,
			onClick: interactive ? (event) => open(id, event.currentTarget) : undefined,
			onKeyDown: interactive
				? (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							event.stopPropagation();
							open(id, event.currentTarget);
						}
					}
				: undefined,
		},
		h(Handle, { id: "previous", type: "target", position: Position.Left }),
		h(
			"div",
			{
				className: data.isContainer ? "lobster-graph__loop-header" : undefined,
				"data-loop-header": data.isContainer ? id : undefined,
			},
			h(
				"div",
				{ className: "lobster-graph__step-header" },
				h(
					"div",
					{ className: "lobster-graph__step-title" },
					data.title ?? (type === "join" ? label.split("\n")[0] : id),
				),
				h("span", { className: "lobster-graph__step-kind" }, nodeLabels[type]),
			),
			shape === "diamond" &&
				h("div", { className: "lobster-graph__approval" }, "◇ Approval required"),
			input && h(WorkflowInputPreview, { definition: input.value }),
			h(
				"dl",
				{ className: "lobster-graph__fields" },
				...fields
					.filter((field) => field !== input)
					.map(({ name, value, language }) => {
						const highlightedLanguage = language ?? (name === "steps" ? "yaml" : undefined);
						return h(
							"div",
							{ className: "lobster-graph__field", key: name },
							h("dt", null, name),
							h(
								"dd",
								null,
								h(SourceText, {
									text: value,
									language: highlightedLanguage,
									field: name,
									code: true,
								}),
							),
						);
					}),
			),
		),
		h(Handle, { id: "next", type: "source", position: Position.Right }),
	);
});

// Native steps and the opaque built-in card share one renderer.
const nodeTypes = { lobster: WorkflowNodeCard };

function WorkflowConnection({ id, markerEnd, label, data }: EdgeProps<WorkflowEdge>) {
	if (!data?.layout) {
		return null;
	}
	const { points, labelPosition } = data.layout;
	// Keep Dagre's obstacle-avoiding route; smoothing it can cut through neighboring cards.
	const path = points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
	return h(
		Fragment,
		null,
		h(BaseEdge, { id, path, markerEnd }),
		label != null &&
			labelPosition &&
			h(EdgeLabelRenderer, {
				children: h(
					"div",
					{
						className: "lobster-graph__edge-label",
						style: {
							transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
						},
					},
					label,
				),
			}),
	);
}
const edgeTypes = { "lobster-native": WorkflowConnection };

function WorkflowFlow({
	graph,
	colorMode,
}: {
	graph: ReturnType<typeof graphFor>;
	colorMode: "light" | "dark";
}) {
	const nodes = useNodes<WorkflowNode>();
	const initialized = useNodesInitialized();
	const { getNodes, setNodes, setEdges, setViewport, viewportInitialized } = useReactFlow<
		WorkflowNode,
		WorkflowEdge
	>();
	const [ready, setReady] = useState(false);
	const [failed, setFailed] = useState(false);
	const flowElement = useRef<HTMLDivElement>(null);
	const bounds = useRef<ReturnType<typeof layoutWorkflowGraph>["bounds"] | null>(null);
	const labelMeasurements = useRef<HTMLDivElement>(null);
	const [labelSizes, setLabelSizes] = useState(
		new Map<string, { width: number; height: number }>(),
	);
	const [containerHeaders, setContainerHeaders] = useState(
		new Map<string, { width: number; height: number }>(),
	);
	// Position updates must not trigger another layout; only changed rendered dimensions do.
	const dimensions = JSON.stringify(
		nodes.map(({ id, measured }) => [id, measured?.width, measured?.height]),
	);
	const fitWorkflow = useCallback(async () => {
		const element = flowElement.current;
		if (!bounds.current || !element?.clientWidth || !element.clientHeight) {
			return false;
		}
		// Include routed dependencies and labels, which React Flow's node-only fit omits.
		return setViewport(
			getViewportForBounds(
				bounds.current,
				element.clientWidth,
				element.clientHeight,
				0.05,
				1,
				0.25,
			),
		);
	}, [setViewport]);
	useLayoutEffect(() => {
		const labels = labelMeasurements.current?.querySelectorAll<HTMLElement>("[data-edge-id]");
		if (!labels) {
			return undefined;
		}
		const headers = flowElement.current?.querySelectorAll<HTMLElement>("[data-loop-header]") ?? [];
		const measure = () => {
			const sizes = new Map(
				Array.from(labels, (element) => [
					element.dataset.edgeId!,
					{ width: element.offsetWidth, height: element.offsetHeight },
				]),
			);
			setLabelSizes((previous) =>
				previous.size === sizes.size &&
				Array.from(sizes).every(([id, size]) => {
					const before = previous.get(id);
					return before?.width === size.width && before.height === size.height;
				})
					? previous
					: sizes,
			);
			const headerSizes = new Map(
				Array.from(headers, (element) => [
					element.dataset.loopHeader!,
					{ width: element.offsetWidth, height: element.offsetHeight },
				]),
			);
			setContainerHeaders((previous) =>
				previous.size === headerSizes.size &&
				Array.from(headerSizes).every(([id, size]) => {
					const before = previous.get(id);
					return before?.width === size.width && before.height === size.height;
				})
					? previous
					: headerSizes,
			);
		};
		const observer = new ResizeObserver(measure);
		labels.forEach((element) => observer.observe(element));
		headers.forEach((element) => observer.observe(element));
		measure();
		return () => observer.disconnect();
	}, [graph, initialized]);
	useEffect(() => {
		if (
			!initialized ||
			!viewportInitialized ||
			graph.nodes.some((node) => node.data.isContainer && !containerHeaders.get(node.id)?.height) ||
			graph.edges.some((edge) => typeof edge.label === "string" && !labelSizes.get(edge.id)?.width)
		) {
			return undefined;
		}
		let disposed = false;
		const arrange = async () => {
			try {
				setReady(false);
				setFailed(false);
				const placed = layoutWorkflowGraph(getNodes(), graph.edges, labelSizes, containerHeaders);
				setNodes(placed.nodes);
				setEdges(placed.edges);
				bounds.current = placed.bounds;
				await fitWorkflow();
				if (!disposed) {
					setReady(true);
				}
			} catch {
				if (!disposed) {
					setFailed(true);
				}
			}
		};
		void arrange();
		return () => {
			disposed = true;
		};
	}, [
		initialized,
		viewportInitialized,
		dimensions,
		labelSizes,
		containerHeaders,
		graph,
		getNodes,
		setNodes,
		setEdges,
		fitWorkflow,
	]);
	return h(
		"div",
		{ className: "lobster-graph__flow", ref: flowElement, "aria-busy": !ready && !failed },
		h(
			"div",
			{
				className: "lobster-graph__edge-measurements",
				ref: labelMeasurements,
				"aria-hidden": true,
			},
			...graph.edges
				.filter((edge) => typeof edge.label === "string")
				.map((edge) =>
					h(
						"div",
						{
							key: edge.id,
							"data-edge-id": edge.id,
							className: "lobster-graph__edge-label",
						},
						edge.label,
					),
				),
		),
		h(
			ReactFlow<WorkflowNode, WorkflowEdge>,
			{
				defaultNodes: graph.nodes,
				defaultEdges: graph.edges,
				nodeTypes,
				edgeTypes,
				colorMode,
				proOptions: { hideAttribution: true },
				style: { opacity: ready ? 1 : 0 },
				inert: !ready,
				"aria-hidden": !ready,
				minZoom: 0.05,
				maxZoom: 2,
				nodesDraggable: false,
				nodesConnectable: false,
				edgesReconnectable: false,
				elementsSelectable: false,
				deleteKeyCode: null,
				ariaLabelConfig: { "controls.fitView.ariaLabel": "Fit workflow to view" },
			},
			h(Background, { gap: 24, size: 1 }),
			h(Controls, {
				showInteractive: false,
				onFitView: () => {
					void fitWorkflow();
				},
			}),
		),
		!ready &&
			h(
				"p",
				{ className: "lobster-graph__status", role: failed ? "alert" : "status" },
				failed ? "Could not arrange workflow. Refresh to try again." : "Arranging workflow…",
			),
	);
}

function createWorkflowView(
	container: HTMLElement,
	initialContext: LobsterViewContext,
	closeDialog?: () => void,
): ReturnType<LobsterView> {
	const { host, signal } = initialContext;
	let workflowId = initialContext.props.workflowId ?? "";
	const page = document.createElement("section");
	page.className = "lobster-graph";
	page.setAttribute("aria-label", "Workflow viewer");
	const header = document.createElement("header");
	header.className = "lobster-graph__header";
	const back = document.createElement("a");
	back.className = "btn btn--sm btn--icon";
	back.href = host.navigation.pageHref({ id: "workflows" });
	back.title = "Back to workflows";
	back.setAttribute("aria-label", "Back to workflows");
	const backIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	backIcon.setAttribute("viewBox", "0 0 24 24");
	backIcon.setAttribute("aria-hidden", "true");
	backIcon.setAttribute("fill", "none");
	backIcon.setAttribute("stroke", "currentColor");
	backIcon.setAttribute("stroke-width", "2");
	backIcon.setAttribute("stroke-linecap", "round");
	backIcon.setAttribute("stroke-linejoin", "round");
	const backPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
	backPath.setAttribute("d", "m12 19-7-7 7-7M19 12H5");
	backIcon.append(backPath);
	back.append(backIcon);
	const heading = document.createElement("div");
	heading.className = "lobster-graph__heading";
	const title = document.createElement("h1");
	title.className = "page-title";
	title.textContent = "Workflow";
	const description = document.createElement("p");
	description.className = "page-subtitle";
	heading.append(title, description);
	const toggle = document.createElement("div");
	toggle.className = "settings-segmented";
	toggle.setAttribute("role", "group");
	toggle.setAttribute("aria-label", "Workflow view");
	const viewButtons = (["flow", "code"] as const).map((mode) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "settings-segmented__btn";
		button.textContent = mode === "flow" ? "Flow" : "Code";
		button.setAttribute("aria-pressed", String(mode === "flow"));
		button.classList.toggle("settings-segmented__btn--active", mode === "flow");
		toggle.append(button);
		return { button, mode };
	});
	if (closeDialog) {
		const close = document.createElement("button");
		close.type = "button";
		close.className = "btn btn--sm btn--icon";
		close.setAttribute("aria-label", "Close subworkflow");
		close.title = "Close subworkflow";
		const icon = backIcon.cloneNode(true) as SVGElement;
		icon.querySelector("path")!.setAttribute("d", "m6 6 12 12M6 18 18 6");
		close.append(icon);
		close.addEventListener("click", closeDialog, { signal });
		header.append(heading, toggle, close);
	} else {
		header.append(back, heading, toggle);
	}
	const canvas = document.createElement("div");
	canvas.className = "lobster-graph__canvas";
	let sourceFiles: readonly LobsterSourceFile[] = [];
	const source = createSourceExplorer({
		host,
		signal,
		onFilesChange(files) {
			sourceFiles = files;
			render();
		},
	});
	const status = document.createElement("p");
	status.className = "lobster-graph__status";
	status.setAttribute("role", "status");
	page.append(header, canvas, source.element, status);
	container.append(page);
	const root = createRoot(canvas);
	let disposed = false;
	let generation = 0;
	let connected = host.connection.connected;
	let colorMode: "light" | "dark" = "dark";
	let graph: ReturnType<typeof graphFor> | undefined;
	let flowError: string | undefined;
	let workflow: LobsterWorkflowDetail | undefined;
	let viewMode: "flow" | "code" = "flow";
	let selectedView = false;
	let closeChild: (() => void) | undefined;
	const openChild = (nodeId: string, trigger: HTMLElement) => {
		if (disposed || signal.aborted || !workflow) {
			return;
		}
		closeChild?.();
		closeChild = openSubworkflowDialog({
			container: page,
			context: initialContext,
			workflow,
			nodeId,
			trigger,
			currentTrigger: () =>
				Array.from(canvas.querySelectorAll<HTMLElement>("[data-subworkflow-id]")).find(
					(element) => element.dataset.subworkflowId === nodeId,
				) ?? header.querySelector<HTMLElement>(".btn"),
			mount: createWorkflowView,
		});
	};

	const showView = () => {
		const hasSource = Boolean(workflow && (workflow.source === "file" || workflow.definition));
		for (const { button, mode } of viewButtons) {
			button.disabled = mode === "flow" ? !graph : !hasSource;
			button.setAttribute("aria-pressed", String(mode === viewMode));
			button.classList.toggle("settings-segmented__btn--active", mode === viewMode);
		}
		// Nodes set visibility themselves. Opacity hides the whole layer without losing its size.
		canvas.style.opacity = viewMode === "flow" ? "1" : "0";
		canvas.inert = viewMode !== "flow";
		canvas.setAttribute("aria-hidden", String(viewMode !== "flow"));
		source.show(viewMode === "code" && hasSource);
		if (workflow) {
			status.setAttribute("role", flowError ? "alert" : "status");
			status.hidden = viewMode === "flow" ? Boolean(graph) : hasSource;
			status.textContent =
				flowError ??
				workflow.unavailableReason ??
				(viewMode === "flow"
					? "This workflow has no steps."
					: "This workflow does not expose a saved definition.");
		}
	};

	const render = () => {
		root.render(
			graph
				? h(ReactFlowProvider, {
						key: `${workflowId}:${generation}`,
						children: h(SubworkflowContext.Provider, {
							value: openChild,
							children: h(SourceLinksContext.Provider, {
								value: {
									files: sourceFiles,
									filename: workflow?.definition?.filename,
									open: (path) => {
										if (source.open(path)) {
											selectedView = true;
											viewMode = "code";
											showView();
										}
									},
								},
								children: h(WorkflowFlow, { graph, colorMode }),
							}),
						}),
					})
				: null,
		);
	};
	const syncTheme = () => {
		const next = getComputedStyle(page).colorScheme === "light" ? "light" : "dark";
		if (next !== colorMode) {
			colorMode = next;
			render();
		}
	};
	const sizeView = () => {
		syncTheme();
		page.style.setProperty(
			"--lobster-graph-top",
			`${Math.max(0, page.getBoundingClientRect().top)}px`,
		);
	};
	const resize = new ResizeObserver(sizeView);
	// Palette loading can apply the root's color scheme after the host notification.
	const themeObserver = new MutationObserver(syncTheme);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["style", "data-theme-mode"],
	});
	resize.observe(page);
	window.addEventListener("resize", sizeView, { signal });
	sizeView();
	syncTheme();

	const load = async () => {
		const current = ++generation;
		graph = undefined;
		flowError = undefined;
		workflow = undefined;
		source.invalidate();
		showView();
		render();
		status.hidden = false;
		status.setAttribute("role", "status");
		title.textContent = "Workflow";
		description.textContent = "";
		page.setAttribute("aria-busy", "false");
		if (!workflowId) {
			status.textContent = "No workflow selected. Return to Workflows to choose one.";
			return;
		}
		if (!connected) {
			status.textContent = "Connect to the workflow server to load this workflow.";
			return;
		}
		status.textContent = "Loading workflow…";
		page.setAttribute("aria-busy", "true");
		try {
			const result = await host.workflows.get(workflowId);
			if (disposed || signal.aborted || current !== generation) {
				return;
			}
			workflow = result.workflow;
			title.textContent = workflow.name;
			description.textContent =
				workflow.description ??
				(workflow.source === "builtin" ? "Built-in workflow" : "Steps in execution order");
			source.setWorkflow(workflowId);
			if (
				!workflow.unavailableReason &&
				(workflow.graph?.nodes.length || workflow.source === "builtin")
			) {
				try {
					graph = graphFor(workflow);
				} catch (error) {
					flowError = `Could not render flow. ${host.errorMessage(error)} Select Code to inspect the definition.`;
				}
			}
			if (flowError) {
				viewMode = "flow";
			} else if (!graph && (workflow.source === "file" || workflow.definition)) {
				viewMode = "code";
			} else if (!selectedView) {
				viewMode = "flow";
			}
			showView();
			render();
			if (workflow.source === "file" || workflow.definition) {
				void source.prepare();
			}
		} catch (error) {
			if (disposed || signal.aborted || current !== generation) {
				return;
			}
			status.setAttribute("role", "alert");
			status.textContent = `Could not load workflow. ${host.errorMessage(error)}`;
		} finally {
			if (!disposed && !signal.aborted && current === generation) {
				page.setAttribute("aria-busy", "false");
			}
		}
	};
	back.addEventListener(
		"click",
		(event) => {
			if (
				event.button === 0 &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.shiftKey &&
				!event.altKey
			) {
				event.preventDefault();
				host.navigation.openPage({ id: "workflows" });
			}
		},
		{ signal },
	);
	for (const { button, mode } of viewButtons) {
		button.addEventListener(
			"click",
			() => {
				selectedView = true;
				viewMode = mode;
				showView();
			},
			{ signal },
		);
	}
	const unsubscribe = host.subscribe(() => {
		syncTheme();
		if (connected !== host.connection.connected) {
			connected = host.connection.connected;
			if (!connected) {
				closeChild?.();
			}
			void load();
		}
	});
	const changes = subscribeWorkflowChanges(initialContext, load, () =>
		workflowId.startsWith("file:"),
	);
	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		generation += 1;
		closeChild?.();
		changes.dispose();
		unsubscribe();
		resize.disconnect();
		themeObserver.disconnect();
		source.dispose();
		window.removeEventListener("resize", sizeView);
		signal.removeEventListener("abort", dispose);
		root.unmount();
		page.remove();
	};
	signal.addEventListener("abort", dispose, { once: true });
	void load();
	return {
		update(context) {
			if (!context.presented) {
				closeChild?.();
			}
			if (context.props.workflowId !== workflowId) {
				closeChild?.();
				workflowId = context.props.workflowId ?? "";
				selectedView = false;
				void load();
			}
			changes.update(context);
		},
		dispose,
	};
}

export const mountWorkflow: LobsterView = (container, context) =>
	createWorkflowView(container, context);
