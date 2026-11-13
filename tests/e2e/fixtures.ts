import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
} from "@playwright/test";
import { BTC_PRICE_URL } from "../../src/web/lib/btc-price";

async function mockBtcPrice(context: BrowserContext) {
  // Context routes cover every tab; page routes can override failure/refresh cases.
  await context.route(BTC_PRICE_URL, (route) =>
    route.fulfill({
      json: { symbol: "BTCTHB", price: "3000000.00000000" },
    }),
  );
}

export const test = base.extend<{
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}>({
  context: async ({ context }, use) => {
    await mockBtcPrice(context);
    await use(context);
  },
  newContext: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];

    await use(async (options) => {
      const context = await browser.newContext(options);

      contexts.push(context);
      await mockBtcPrice(context);

      return context;
    });

    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect, type Page } from "@playwright/test";
