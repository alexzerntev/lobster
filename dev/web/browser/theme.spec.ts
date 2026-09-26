import { expect, test } from "@playwright/test";

test("system theme changes reach graphs and child Code without resetting the view", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
	await page.goto("/workflow?id=file%3Abm9kZS10eXBlcy5sb2JzdGVy");
	await expect(page.locator('.lobster-graph__flow[aria-busy="false"]')).toBeVisible();
	const viewport = page.locator(".react-flow__viewport");
	const zoom = () =>
		viewport.evaluate((element) =>
			Number(element.getAttribute("style")?.match(/scale\(([^)]+)\)/)?.[1]),
		);
	const initialZoom = await zoom();
	await page.getByRole("button", { name: "Zoom In", exact: true }).click();
	await expect.poll(zoom).toBeCloseTo(initialZoom * 1.2, 5);
	const transform = await viewport.getAttribute("style");
	await page.getByRole("button", { name: "Open subworkflow child_workflow", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.locator('.lobster-graph__flow[aria-busy="false"]')).toBeVisible();
	await dialog.getByRole("button", { name: "Code", exact: true }).click();
	await expect(dialog.locator("pre .hljs-attr").first()).toBeVisible();
	const selection = await dialog.locator('[aria-current="true"]').getAttribute("data-path");
	const source = await dialog.locator("pre").textContent();
	let workflowReads = 0;
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/api/workflow")) workflowReads++;
	});
	const appearances: unknown[] = [];
	for (const mode of ["light", "dark", "light"] as const) {
		await page.emulateMedia({ colorScheme: mode });
		await expect(page.locator(`.react-flow.${mode}`)).toHaveCount(2);
		const colors = await dialog.evaluate((element) => {
			const probe = document.createElement("span");
			element.append(probe);
			const token = (name: string) => {
				probe.style.color = `var(${name})`;
				return getComputedStyle(probe).color;
			};
			const read = (selector: string, property: "color" | "backgroundColor") =>
				getComputedStyle(element.querySelector(selector)!)[property];
			const result = {
				canvas: read(".react-flow", "backgroundColor"),
				bg: token("--bg"),
				card: read(".lobster-graph__step", "backgroundColor"),
				cardToken: token("--card"),
				text: read(".lobster-graph__step-title", "color"),
				textToken: token("--text-strong"),
				code: read(".hljs-attr", "color"),
				codeToken: token("--hljs-attribute"),
			};
			probe.remove();
			return result;
		});
		expect(colors.canvas).toBe(colors.bg);
		expect(colors.card).toBe(colors.cardToken);
		expect(colors.text).toBe(colors.textToken);
		expect(colors.code).toBe(colors.codeToken);
		expect(colors.text).not.toBe(colors.card);
		appearances.push(colors);
		await expect(page.locator(".react-flow__viewport").first()).toHaveAttribute(
			"style",
			transform!,
		);
		await expect(dialog.getByRole("button", { name: "Code", exact: true })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(dialog.locator('[aria-current="true"]')).toHaveAttribute("data-path", selection!);
		await expect(dialog.locator("pre")).toHaveText(source!);
	}
	expect(appearances[0]).not.toEqual(appearances[1]);
	expect(appearances[2]).toEqual(appearances[0]);
	expect(workflowReads).toBe(0);
	await dialog.getByRole("button", { name: "Close subworkflow" }).click();
	await expect(dialog).toHaveCount(0);
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator(".react-flow.dark")).toHaveCount(1);
});

test("an explicit preview theme overrides system changes", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/workflow?id=builtin%3Agithub.pr.monitor&theme=light");
	await expect(page.locator(".react-flow.light")).toBeVisible();
	await page.emulateMedia({ colorScheme: "light" });
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator(".react-flow.light")).toBeVisible();
});
