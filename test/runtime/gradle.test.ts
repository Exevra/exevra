import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { loadConfig } from "../../src/core/config.js";
import {
  discoverGradleModules,
  type GradleModule,
} from "../../src/runtime/gradle.js";
import { loadConfiguredReports } from "../../src/runtime/reports.js";

const temporaryProject = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "exevra-gradle-"));

const writeSettings = async (root: string, source: string): Promise<void> => {
  await writeFile(join(root, "settings.gradle"), source);
};

const writeDirectory = async (root: string, path: string): Promise<void> => {
  await mkdir(join(root, path), { recursive: true });
};

const writeReport = async (
  root: string,
  path: string,
  suite: string,
): Promise<void> => {
  const report = join(root, path);
  await mkdir(dirname(report), { recursive: true });
  await writeFile(
    report,
    `<testsuite name="${suite}"><testcase classname="${suite}" name="test"/></testsuite>`,
  );
};

const gradleConfig = () =>
  loadConfig({
    version: 1,
    baseline: ".exevra/baseline.json",
    command: "gradle test",
    reports: ["build/test-results/test/TEST-*.xml"],
    gradle: { modules: "auto" },
    policy: { default: { min_executed: 1, max_drop_percent: 0 } },
  });

test("discovers included Gradle projects and custom project directories", async () => {
  const root = await temporaryProject();
  try {
    await writeSettings(
      root,
      "rootProject.name = 'sample'\n" +
        "include ':app', ':services:api'\n" +
        "project(':services:api').projectDir = file('components/api')\n",
    );
    await writeDirectory(root, "app");
    await writeDirectory(root, "components/api");

    assert.deepEqual(
      (await discoverGradleModules(root)).map(
        ({ path, projectPath, aggregator }): Pick<GradleModule, "path" | "projectPath" | "aggregator"> => ({
          path,
          projectPath,
          aggregator,
        }),
      ),
      [
        { path: "app", projectPath: ":app", aggregator: false },
        {
          path: "components/api",
          projectPath: ":services:api",
          aggregator: false,
        },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers Kotlin DSL includes and falls back to the root project", async () => {
  const root = await temporaryProject();
  try {
    await writeFile(
      join(root, "settings.gradle.kts"),
      'rootProject.name = "sample"\ninclude("app", "services:api")\n',
    );
    await writeDirectory(root, "app");
    await writeDirectory(root, "services/api");

    assert.deepEqual(
      (await discoverGradleModules(root)).map(({ path, projectPath }) => ({
        path,
        projectPath,
      })),
      [
        { path: "app", projectPath: ":app" },
        { path: "services/api", projectPath: ":services:api" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const fallback = await temporaryProject();
  try {
    assert.deepEqual(await discoverGradleModules(fallback), [
      { path: ".", projectPath: ":", aggregator: false },
    ]);
  } finally {
    await rm(fallback, { recursive: true, force: true });
  }
});

test("falls back to the root project when settings contain no includes", async () => {
  const root = await temporaryProject();
  try {
    await writeSettings(root, "rootProject.name = 'sample'\n");
    await writeReport(root, "build/test-results/test/TEST-root.xml", "root");

    assert.deepEqual(await discoverGradleModules(root), [
      { path: ".", projectPath: ":", aggregator: false },
    ]);
    const result = await loadConfiguredReports(root, gradleConfig());
    assert.deepEqual(result.missingReports, []);
    assert.deepEqual(result.suites.map(({ name }) => name), ["root"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a missing included Gradle project directory", async () => {
  const root = await temporaryProject();
  try {
    await writeSettings(root, "include(':missing')\n");

    await assert.rejects(
      discoverGradleModules(root),
      /Gradle module directory is missing: missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collects standard Gradle reports for every included project", async () => {
  const root = await temporaryProject();
  try {
    await writeSettings(root, "include(':app', ':services:api')\n");
    await writeDirectory(root, "app");
    await writeDirectory(root, "services/api");
    await writeReport(root, "app/build/test-results/test/TEST-app.xml", "app");
    await writeReport(
      root,
      "services/api/build/test-results/test/TEST-api.xml",
      "api",
    );

    const result = await loadConfiguredReports(root, gradleConfig());

    assert.deepEqual(result.missingReports, []);
    assert.deepEqual(result.unreadableReports, []);
    assert.deepEqual(result.suites.map(({ name }) => name), ["api", "app"]);
    assert.deepEqual(
      result.reportPaths.map((path) => relative(root, path)),
      [
        "app/build/test-results/test/TEST-app.xml",
        "services/api/build/test-results/test/TEST-api.xml",
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("makes a missing Gradle project report visible", async () => {
  const root = await temporaryProject();
  try {
    await writeSettings(root, "include(':app', ':services:api')\n");
    await writeDirectory(root, "app");
    await writeDirectory(root, "services/api");
    await writeReport(root, "app/build/test-results/test/TEST-app.xml", "app");

    const result = await loadConfiguredReports(root, gradleConfig());

    assert.deepEqual(result.suites.map(({ name }) => name), ["app"]);
    assert.deepEqual(result.missingReports, [
      "services/api/build/test-results/test/TEST-*.xml",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("makes an unreadable Gradle report directory visible", async () => {
  const root = await temporaryProject();
  const reports = join(root, "app/build/test-results/test");
  try {
    await writeSettings(root, "include(':app')\n");
    await writeDirectory(root, "app");
    await mkdir(reports, { recursive: true });
    await chmod(reports, 0o000);

    const result = await loadConfiguredReports(root, gradleConfig());

    assert.deepEqual(result.missingReports, []);
    assert.deepEqual(result.unreadableReports, [
      "app/build/test-results/test/TEST-*.xml",
    ]);
  } finally {
    await chmod(reports, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
