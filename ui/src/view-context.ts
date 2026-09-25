/** Services supplied by the embedding application; the viewer owns no server or transport. */
export type LobsterPageTarget = { id: string; params?: Readonly<Record<string, string>> };
export type LobsterDialogProps = {
	label: string;
	description?: string;
	className?: string;
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
				update: (props: LobsterDialogProps) => void;
				dispose: () => void;
			};
		};
		request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
		subscribe: (listener: () => void) => () => void;
		onEvent: (event: string, listener: (payload: unknown) => void) => () => void;
		redact: (text: string) => string;
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
