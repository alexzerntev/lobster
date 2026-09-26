// Only persistence is synthetic. The external producer owns presentation and notifications.
type Preferences = {
	theme: "claw" | "knot";
	themeMode: "light" | "dark";
	gatewayUrl: string;
};

const initial: Preferences = {
	theme: "claw",
	themeMode: "light",
	gatewayUrl: "ws://theme-check.invalid",
};
let preferences = { ...initial };
let owner: { refresh: () => void } | undefined;

export function resetPreferences() {
	if (owner) throw new Error("Dispose the previous theme check before creating another.");
	preferences = { ...initial };
}

export function bindUiPreferences(next: { refresh: () => void }) {
	if (owner) throw new Error("The theme check already has a preference owner.");
	owner = next;
	return () => {
		if (owner === next) owner = undefined;
	};
}

export function loadUiPreferences() {
	return { ...preferences };
}

export function patchSettings(patch: Partial<Preferences>) {
	preferences = { ...preferences, ...patch };
	owner?.refresh();
	return { ...preferences, token: "" };
}

export function settingsKeyForGateway() {
	return "lobster.theme-check.preferences";
}
