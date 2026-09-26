import type {
	LobsterWorkflowFileResult,
	LobsterWorkflowFilesResult,
	LobsterWorkflowResult,
	LobsterWorkflowsResult,
} from "../workflow-types.js";

export { WorkflowViewError, workflowErrorMessage } from "./workflow-errors.js";

/** Services supplied by the embedding application; the viewer owns no server or transport. */
export type LobsterPageTarget = { id: string; params?: Readonly<Record<string, string>> };
export type LobsterDialogProps = {
	label: string;
	style?: string;
	content: HTMLElement;
	returnFocusTarget?: HTMLElement | null;
	onCancel: () => boolean | void;
};
export type LobsterViewContext = {
	readonly host: {
		readonly connection: { readonly connected: boolean };
		readonly components: {
			mountDialog: (
				container: HTMLElement,
				props: LobsterDialogProps,
			) => {
				dispose: () => void;
			};
		};
		readonly workflows: {
			list: () => Promise<LobsterWorkflowsResult>;
			get: (id: string) => Promise<LobsterWorkflowResult>;
			files: (id: string) => Promise<LobsterWorkflowFilesResult>;
			file: (id: string, path: string) => Promise<LobsterWorkflowFileResult>;
		};
		subscribe: (listener: () => void) => () => void;
		onWorkflowsChanged: (listener: () => void) => () => void;
		errorMessage: (error: unknown) => string;
		navigation: {
			pageHref: (target: LobsterPageTarget) => string;
			openPage: (target: LobsterPageTarget) => void;
		};
	};
	readonly signal: AbortSignal;
	readonly props: Readonly<Record<string, string>>;
	readonly presented: boolean;
};
export type LobsterView = (
	container: HTMLElement,
	context: LobsterViewContext,
) => {
	update?: (context: LobsterViewContext) => void;
	dispose?: () => void;
} | void;
