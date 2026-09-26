import { createApplicationTheme } from "virtual:lobster-openclaw-theme-producer";
import "virtual:lobster-openclaw-theme-styles";
import type { ThemeCheckDriver } from "./driver-types.js";
import { loadUiPreferences, patchSettings, resetPreferences } from "./preferences.js";

/** Exercises the real theme producer, with no Gateway or operator preferences. */
export function createThemeDriver(root: HTMLElement): ThemeCheckDriver {
	if (root.ownerDocument !== globalThis.document) {
		throw new Error("The OpenClaw theme producer controls the current document.");
	}
	resetPreferences();
	const settings = { ...loadUiPreferences(), token: "" };
	const theme = createApplicationTheme(settings, {
		snapshot: { phase: "disconnected" },
		connection: { gatewayUrl: settings.gatewayUrl },
		subscribe: () => () => {},
	});
	if (
		typeof theme.setMode !== "function" ||
		typeof theme.subscribe !== "function" ||
		typeof theme.dispose !== "function"
	) {
		throw new Error("OpenClaw's theme producer contract changed; update the optional check.");
	}
	let notifications = 0;
	let disposed = false;
	const stop = theme.subscribe(() => notifications++);
	const check = () => {
		if (disposed) throw new Error("The theme check has been disposed.");
	};
	return {
		setMode(mode) {
			check();
			theme.setMode(mode);
		},
		setFamily(family) {
			check();
			patchSettings({ theme: family });
		},
		subscribe(listener) {
			check();
			return theme.subscribe(listener);
		},
		get notifications() {
			return notifications;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stop();
			theme.dispose();
		},
	};
}
