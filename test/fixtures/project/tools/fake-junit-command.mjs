import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const output = process.argv[2];
const { mode } = JSON.parse(await readFile("runner-config.json", "utf8"));
if (mode === "fail-command") process.exit(23);
if (mode === "no-report") process.exit(0);
await mkdir(dirname(output), { recursive: true });
if (mode === "invalid-report") {
  await writeFile(output, '<testsuite name="unit"><SECRET_TOKEN_ABC>\n');
  process.exit(0);
}
const tests = mode === "zero" ? 0 : mode === "reduced" ? 8 : 10;
const cases = Array.from(
  { length: tests },
  (_, index) =>
    `<testcase classname="unit" name="${
      mode === "identity-shift" && index === 9
        ? "renamed-test"
        : `test-${index + 1}`
    }"/>`,
).join("");
await writeFile(output, `<testsuite name="unit">${cases}</testsuite>\n`);
