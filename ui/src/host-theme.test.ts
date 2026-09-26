import { afterEach, expect, it, vi } from "vitest";
import { observeHostTheme } from "./host-theme.js";

afterEach(() =>
	document.head.querySelectorAll("[data-theme-test]").forEach((node) => node.remove()),
);

it.each(["throw", "abort"])(
	"releases browser listeners when host subscription ends with %s",
	(ending) => {
		const lifetime = new AbortController();
		const root = document.createElement("div");
		root.style.colorScheme = "light";
		document.body.append(root);
		const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
		const remove = vi.spyOn(document, "removeEventListener");
		const stop = vi.fn();
		try {
			expect(() =>
				observeHostTheme(root, lifetime.signal, () => {
					if (ending === "throw") throw new Error("Host activation ended");
					lifetime.abort();
					return stop;
				}),
			).toThrow();
			expect(disconnect).toHaveBeenCalledTimes(1);
			expect(remove).toHaveBeenCalledWith("load", expect.any(Function), true);
			expect(stop).toHaveBeenCalledTimes(ending === "abort" ? 1 : 0);
		} finally {
			lifetime.abort();
			disconnect.mockRestore();
			remove.mockRestore();
			root.remove();
		}
	},
);

it("publishes rendered modes after early host notifications and late palette application", async () => {
	const lifetime = new AbortController();
	const root = document.createElement("div");
	root.style.colorScheme = "light";
	document.body.append(root);
	let notifyHost = () => {};
	const stopHost = vi.fn();
	const theme = observeHostTheme(root, lifetime.signal, (notify) => {
		notifyHost = notify;
		return stopHost;
	});
	const modes: string[] = [];
	const stop = theme.subscribe(() => modes.push(theme.colorMode));
	try {
		expect(theme.colorMode).toBe("light");
		notifyHost(); // OpenClaw can notify before a palette arrives.
		expect(modes).toEqual([]);
		root.style.colorScheme = "dark";
		await Promise.resolve();
		expect(modes).toEqual(["dark"]);
		notifyHost();
		expect(modes).toEqual(["dark"]);
		root.style.colorScheme = "light";
		await Promise.resolve();
		expect(modes).toEqual(["dark", "light"]);
		stop();
		root.style.colorScheme = "dark";
		await Promise.resolve();
		expect(modes).toEqual(["dark", "light"]);
		const retired = vi.fn();
		theme.subscribe(retired);
		lifetime.abort();
		root.style.colorScheme = "light";
		notifyHost();
		await Promise.resolve();
		expect(retired).not.toHaveBeenCalled();
		expect(stopHost).toHaveBeenCalledTimes(1);
		expect(() => theme.subscribe(retired)).toThrow();
	} finally {
		lifetime.abort();
		root.remove();
	}
});

it("rechecks a loaded stylesheet even when the host's attributes stay unchanged", async () => {
	const lifetime = new AbortController();
	const root = document.createElement("div");
	root.className = "palette-test";
	document.body.append(root);
	const sheet = document.createElement("style");
	sheet.dataset.themeTest = "";
	sheet.textContent = ".palette-test { color-scheme: light; }";
	document.head.append(sheet);
	const theme = observeHostTheme(root, lifetime.signal);
	const modes: string[] = [];
	theme.subscribe(() => modes.push(theme.colorMode));
	try {
		sheet.textContent = ".palette-test { color-scheme: dark; }";
		sheet.dispatchEvent(new Event("load"));
		expect(modes).toEqual(["dark"]);
		lifetime.abort();
		sheet.textContent = ".palette-test { color-scheme: light; }";
		sheet.dispatchEvent(new Event("load"));
		expect(modes).toEqual(["dark"]);
	} finally {
		lifetime.abort();
		root.remove();
	}
});
