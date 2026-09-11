import { test } from "@playwright/test";

test("debug provider failure", async ({ page }) => {
  page.on("console", (m) => console.log("CONSOLE:", m.type(), m.text().slice(0, 200)));
  page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
  await page.addInitScript(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new Proxy(window.location, {
        get: (target, prop) =>
          prop === "assign" || prop === "replace"
            ? () => {
                throw new Error("blocked navigation");
              }
            : Reflect.get(target, prop),
      }),
    });
  });

  await page.goto("/login", { waitUntil: "networkidle" });
  const button = page.getByRole("button", { name: /Sign in with Google/ });
  await button.click();
  await page.waitForTimeout(4000);
  console.log("URL:", page.url());
  console.log("BUTTON DISABLED:", await button.isDisabled());
  console.log("BUTTON TEXT:", await button.textContent());
  console.log("ALERT COUNT:", await page.getByRole("alert").count());
  console.log("LOCATION ASSIGN PATCHED:", await page.evaluate(() => typeof (window.location as unknown as { assign: unknown }).assign));
});
