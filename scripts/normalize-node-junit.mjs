import { readFile, writeFile } from "node:fs/promises";

const reportPath = "artifacts/junit.xml";
const source = await readFile(reportPath, "utf8");
const inner = source
  .replace(/^\uFEFF?\s*<\?xml[^>]*?>\s*/, "")
  .replace(/^\s*<testsuites[^>]*>\s*/, "")
  .replace(/\s*<\/testsuites>\s*$/, "");

if (inner === source || !inner.trim()) {
  throw new Error(`could not normalize Node JUnit report at ${reportPath}`);
}

await writeFile(
  reportPath,
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="node:test">${inner}</testsuite></testsuites>\n`,
);
