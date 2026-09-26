declare module "virtual:lobster-theme-driver" {
	export function createThemeDriver(
		root: HTMLElement,
	): import("./driver-types.js").ThemeCheckDriver;
}

declare module "virtual:lobster-openclaw-theme-styles" {}

declare module "virtual:lobster-openclaw-theme-producer" {
	export function createApplicationTheme(
		settings: {
			theme: "claw" | "knot";
			themeMode: "light" | "dark";
			gatewayUrl: string;
			token: string;
		},
		gateway: {
			snapshot: { phase: "disconnected" };
			connection: { gatewayUrl: string };
			subscribe: (listener: () => void) => () => void;
		},
	): {
		setMode: (mode: "light" | "dark") => void;
		subscribe: (listener: () => void) => () => void;
		dispose: () => void;
	};
}
