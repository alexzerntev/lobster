import { expect, test } from "@playwright/test";

test("OpenClaw's actual theme producer updates the viewer after a delayed palette", async ({
	page,
}) => {
	if (!process.env.LOBSTER_OPENCLAW_ROOT)
		throw new Error(
			"Set LOBSTER_OPENCLAW_ROOT to an OpenClaw source checkout for this optional check.",
		);
	await page.emulateMedia({ reducedMotion: "reduce" });
	const errors: string[] = [];
	page.on("pageerror", (error) => {
		if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
	});
	await page.goto("/browser/openclaw.html");
	await expect(page.locator('.lobster-graph__flow[aria-busy="false"]')).toBeVisible();
	await expect(page.locator(".react-flow.light")).toBeVisible();
	const viewport = page.locator(".react-flow__viewport");
	const transform = await viewport.getAttribute("style");
	const light = await page
		.locator(".lobster-graph__step--run")
		.first()
		.evaluate((element) => ({
			background: getComputedStyle(element).backgroundColor,
			color: getComputedStyle(element).color,
		}));
	const release = Promise.withResolvers<void>();
	const requested = Promise.withResolvers<void>();
	await page.route("**/__openclaw-theme-assets/themes/knot.css", async (route) => {
		requested.resolve();
		await release.promise;
		await route.continue();
	});
	try {
		await page.getByRole("button", { name: "Knot dark", exact: true }).click();
		await requested.promise;
		await expect(page.locator("#notifications")).not.toHaveText("0");
		await expect(page.locator(".react-flow.light")).toBeVisible();
		const earlyNotifications = await page.locator("#notifications").textContent();
		release.resolve();
		await expect(page.locator(".react-flow.dark")).toBeVisible();
		await expect(page.locator("#notifications")).toHaveText(earlyNotifications!);
		const dark = await page
			.locator(".lobster-graph__step--run")
			.first()
			.evaluate((element) => ({
				background: getComputedStyle(element).backgroundColor,
				color: getComputedStyle(element).color,
			}));
		expect(dark.background).not.toBe(light.background);
		expect(dark.color).not.toBe(light.color);
		for (const mode of ["Light", "Dark", "Light"]) {
			await page.getByRole("button", { name: mode, exact: true }).click();
			await expect(page.locator(`.react-flow.${mode.toLowerCase()}`)).toBeVisible();
			await expect(viewport).toHaveAttribute("style", transform!);
		}
		await page.getByRole("button", { name: "Dispose viewer", exact: true }).click();
		await expect(page.locator(".react-flow")).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally {
		release.resolve();
	}
});
