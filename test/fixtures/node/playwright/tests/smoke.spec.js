import { expect, test } from "@playwright/test";

test("the Playwright fixture runs a real test", async () => {
  expect(2 + 2).toBe(4);
});
