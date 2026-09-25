import type { LobsterWorkflowsResult } from "../workflow-types.js";
import type { LobsterView } from "./view-context.js";
import { subscribeWorkflowChanges } from "./workflow-changes.js";
import "./styles.css";

const pageSize = 20;

export const mountWorkflows: LobsterView = (container, context) => {
	const { host, signal } = context;
	const page = document.createElement("section");
	page.className = "lobster-workflows";
	page.setAttribute("aria-label", "Lobster workflows");

	const header = document.createElement("header");
	header.className = "content-header content-header--settings content-header--page";
	const heading = document.createElement("div");
	const title = document.createElement("h1");
	title.className = "page-title";
	title.textContent = "Lobster";
	const subtitle = document.createElement("p");
	subtitle.className = "page-subtitle";
	subtitle.textContent = "Workspace workflows and built-ins available from Lobster.";
	heading.append(title, subtitle);
	header.append(heading);

	const content = document.createElement("div");
	content.className = "settings-page settings-page--wide lobster-workflows__content";
	const searchBox = document.createElement("div");
	searchBox.className = "lobster-workflows__search";
	const searchIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	searchIcon.setAttribute("viewBox", "0 0 24 24");
	searchIcon.setAttribute("aria-hidden", "true");
	searchIcon.setAttribute("fill", "none");
	searchIcon.setAttribute("stroke", "currentColor");
	searchIcon.setAttribute("stroke-width", "2");
	searchIcon.setAttribute("stroke-linecap", "round");
	const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	circle.setAttribute("cx", "11");
	circle.setAttribute("cy", "11");
	circle.setAttribute("r", "8");
	const handle = document.createElementNS("http://www.w3.org/2000/svg", "path");
	handle.setAttribute("d", "m21 21-4.3-4.3");
	searchIcon.append(circle, handle);
	const search = document.createElement("input");
	search.type = "search";
	search.className = "settings-input";
	search.placeholder = "Search workflows";
	search.setAttribute("aria-label", "Search workflows");
	searchBox.append(searchIcon, search);

	const panel = document.createElement("section");
	panel.className = "settings-group lobster-workflows__panel";
	const columns = document.createElement("div");
	columns.className = "lobster-workflows__columns";
	columns.setAttribute("aria-hidden", "true");
	for (const label of ["Name", "Source"]) {
		const column = document.createElement("span");
		column.textContent = label;
		columns.append(column);
	}
	const status = document.createElement("p");
	status.className = "lobster-workflows__status";
	status.setAttribute("role", "status");
	const list = document.createElement("ul");
	list.className = "lobster-workflows__list";
	list.setAttribute("aria-label", "Workflows");
	const count = document.createElement("div");
	count.className = "lobster-workflows__count";
	count.setAttribute("role", "status");
	const footer = document.createElement("div");
	footer.className = "lobster-workflows__footer";
	footer.hidden = true;
	const loadMore = document.createElement("button");
	loadMore.type = "button";
	loadMore.className = "btn btn--sm lobster-workflows__load-more";
	loadMore.textContent = "Load more";
	footer.append(count);
	panel.append(columns, status, list, footer);
	content.append(searchBox, panel);
	page.append(header, content);
	container.append(page);

	let disposed = false;
	let generation = 0;
	let connected = host.connection.connected;
	let visibleLimit = pageSize;
	let workflows: LobsterWorkflowsResult["workflows"] | undefined;
	const renderList = () => {
		if (!workflows) {
			return;
		}
		const query = search.value.trim().toLocaleLowerCase();
		const matches = workflows.filter(({ name, description }) =>
			`${name}\n${description ?? ""}`.toLocaleLowerCase().includes(query),
		);
		const visible = matches.slice(0, visibleLimit);
		list.replaceChildren(
			...visible.map(({ id, name, description, source }) => {
				const row = document.createElement("li");
				row.className = "lobster-workflows__item";
				const link = document.createElement("a");
				link.className = "lobster-workflows__link";
				const target = { id: "workflow", params: { workflowId: id } };
				link.href = host.navigation.pageHref(target);
				link.addEventListener("click", (event) => {
					if (
						event.button === 0 &&
						!event.metaKey &&
						!event.ctrlKey &&
						!event.shiftKey &&
						!event.altKey
					) {
						event.preventDefault();
						host.navigation.openPage(target);
					}
				});
				const copy = document.createElement("div");
				copy.className = "lobster-workflows__copy";
				const nameElement = document.createElement("div");
				nameElement.className = "lobster-workflows__name";
				nameElement.textContent = name;
				nameElement.title = name;
				copy.append(nameElement);
				if (description) {
					const descriptionElement = document.createElement("div");
					descriptionElement.className = "lobster-workflows__description";
					descriptionElement.textContent = description;
					descriptionElement.title = description;
					copy.append(descriptionElement);
				}
				const kind = document.createElement("span");
				kind.className = "lobster-workflows__source";
				kind.textContent = source === "file" ? "Workflow file" : "Built-in";
				link.append(copy, kind);
				row.append(link);
				return row;
			}),
		);
		status.hidden = visible.length > 0;
		status.textContent =
			workflows.length > 0 ? "No matching workflows." : "No workflows available.";
		footer.hidden = workflows.length === 0;
		count.textContent = `${visible.length} of ${matches.length}`;
		if (visible.length < matches.length) {
			if (loadMore.parentElement !== footer) {
				footer.append(loadMore);
			}
		} else {
			loadMore.remove();
		}
	};
	const load = async () => {
		const current = ++generation;
		workflows = undefined;
		list.replaceChildren();
		footer.hidden = true;
		status.hidden = false;
		status.setAttribute("role", "status");
		if (!connected) {
			status.textContent = "Connect to the workflow server to load workflows.";
			panel.setAttribute("aria-busy", "false");
			return;
		}
		status.textContent = "Loading workflows…";
		panel.setAttribute("aria-busy", "true");
		try {
			const result = await host.request<LobsterWorkflowsResult>("lobster.workflows.list", {});
			if (disposed || signal.aborted || current !== generation) {
				return;
			}
			workflows = result.workflows;
			renderList();
		} catch (error) {
			if (disposed || signal.aborted || current !== generation) {
				return;
			}
			status.setAttribute("role", "alert");
			status.textContent = `Could not load workflows. ${host.redact(error instanceof Error ? error.message : String(error))}`;
		} finally {
			if (!disposed && !signal.aborted && current === generation) {
				panel.setAttribute("aria-busy", "false");
			}
		}
	};
	search.addEventListener(
		"input",
		() => {
			visibleLimit = pageSize;
			renderList();
		},
		{ signal },
	);
	loadMore.addEventListener(
		"click",
		() => {
			visibleLimit += pageSize;
			renderList();
		},
		{ signal },
	);
	const unsubscribe = host.subscribe(() => {
		if (connected !== host.connection.connected) {
			connected = host.connection.connected;
			void load();
		}
	});
	const changes = subscribeWorkflowChanges(context, load);
	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		generation += 1;
		changes.dispose();
		unsubscribe();
		signal.removeEventListener("abort", dispose);
		page.remove();
	};
	signal.addEventListener("abort", dispose, { once: true });
	void load();
	return { update: changes.update, dispose };
};
