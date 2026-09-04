import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  detectMavenFilters,
  discoverMavenModules,
  mavenFilterFinding,
} from "../../src/runtime/maven.js";
import { RuntimeError } from "../../src/runtime/paths.js";

const pom = (body: string): string =>
  `<project xmlns="http://maven.apache.org/POM/4.0.0">${body}</project>`;

const temporaryProject = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "exevra-maven-"));

const writePom = async (
  root: string,
  path: string,
  body: string,
): Promise<void> => {
  const pomPath = join(root, path, "pom.xml");
  await mkdir(dirname(pomPath), { recursive: true });
  await writeFile(pomPath, pom(body));
};

test("detects Maven test-selection flags without their values", () => {
  assert.deepEqual(
    detectMavenFilters(
      "mvn verify -Dtest=UserServiceTest -Dgroups integration -DskipITs",
    ),
    ["-Dgroups", "-DskipITs", "-Dtest"],
  );
  assert.deepEqual(detectMavenFilters("mvn verify -Dtest UserServiceTest"), [
    "-Dtest",
  ]);
  assert.deepEqual(
    detectMavenFilters(
      "mvn verify -Dtest=UserServiceTest -Dtest OtherTest -DexcludedGroups=slow -DskipTests -Dmaven.test.skip=true -DskipITs",
    ),
    [
      "-DexcludedGroups",
      "-Dmaven.test.skip",
      "-DskipITs",
      "-DskipTests",
      "-Dtest",
    ],
  );
  assert.deepEqual(detectMavenFilters("mvn verify -Dit.test=SmokeIT"), [
    "-Dit.test",
  ]);
  assert.deepEqual(detectMavenFilters("mvn verify"), []);
});

test("recognizes shell operators and quoted arguments but rejects near misses", () => {
  assert.deepEqual(
    detectMavenFilters(
      'mvn verify&&-Dtest=UserServiceTest -DskipTests; "-Dgroups=integration"',
    ),
    ["-Dgroups", "-DskipTests", "-Dtest"],
  );
  assert.deepEqual(
    detectMavenFilters(
      "mvn verify -DexcludedGroups| -Dmaven.test.skip&& -DskipITs",
    ),
    ["-DexcludedGroups", "-Dmaven.test.skip", "-DskipITs"],
  );
  assert.deepEqual(
    detectMavenFilters(
      "mvn verify --Dtest -Dtesting -DskipTestsExtra -DskipITs-more -DgroupsExtra",
    ),
    [],
  );
});

test("creates safe Maven filter findings according to policy", () => {
  const command = "mvn verify -Dtest=UserServiceTest -Dgroups integration";
  const finding = mavenFilterFinding(command, "warn");

  assert.deepEqual(finding, {
    code: "TEST_FILTERED",
    severity: "warning",
    message:
      "Maven test-selection flags detected in the configured command: -Dgroups, -Dtest.",
    remediation:
      "Remove the flags for a full test run, or explicitly set maven.filter_policy: off after reviewing the intended test scope.",
  });
  assert.equal(mavenFilterFinding(command, "off"), undefined);
  assert.equal(mavenFilterFinding("mvn verify", "warn"), undefined);
  assert.doesNotMatch(JSON.stringify(finding), /UserServiceTest|integration/);
  assert.doesNotMatch(JSON.stringify(finding), new RegExp(command));
  assert.equal(mavenFilterFinding(command, "enforce")?.severity, "error");
});

test("discovers the root when no pom.xml exists", async () => {
  const root = await temporaryProject();
  try {
    assert.deepEqual(await discoverMavenModules(root), [
      { path: ".", pomPath: "pom.xml", aggregator: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers nested literal modules and excludes the root aggregator", async () => {
  const root = await temporaryProject();
  try {
    await writePom(
      root,
      ".",
      "<packaging>pom</packaging><modules><module>app</module><module>build-parent</module></modules>",
    );
    await writePom(
      root,
      "app",
      "<packaging>jar</packaging><modules><module>component</module></modules>",
    );
    await writePom(root, "app/component", "<packaging>jar</packaging>");
    await writePom(root, "build-parent", "<packaging>pom</packaging>");
    await mkdir(join(root, "app", "src", "test", "java"), { recursive: true });
    await writeFile(
      join(root, "app", "src", "test", "java", "AppTest.java"),
      "class AppTest {}",
    );

    assert.deepEqual(
      (await discoverMavenModules(root)).map(({ path, aggregator, hasTestSources }) => ({
        path,
        aggregator,
        ...(hasTestSources === undefined ? {} : { hasTestSources }),
      })),
      [
        { path: "app", aggregator: false, hasTestSources: true },
        { path: "app/component", aggregator: false, hasTestSources: false },
        { path: "build-parent", aggregator: true },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recognizes Maven test sources and compiled test classes", async () => {
  const root = await temporaryProject();
  try {
    await writePom(
      root,
      ".",
      "<packaging>pom</packaging><modules><module>custom-tests</module></modules>",
    );
    await writePom(
      root,
      "custom-tests",
      "<packaging>jar</packaging><build><testOutputDirectory>target/custom-test-classes</testOutputDirectory></build>",
    );
    await mkdir(join(root, "custom-tests", "target", "test-classes"), {
      recursive: true,
    });
    await writeFile(
      join(root, "custom-tests", "target", "test-classes", "CustomTest.class"),
      "compiled",
    );

    assert.deepEqual(await discoverMavenModules(root), [
      {
        path: "custom-tests",
        pomPath: "custom-tests/pom.xml",
        aggregator: false,
        hasTestSources: true,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("visits duplicate and cyclic module declarations once", async () => {
  const root = await temporaryProject();
  try {
    await writePom(
      root,
      ".",
      "<packaging>pom</packaging><modules><module>a</module><module>b</module><module>a</module></modules>",
    );
    await writePom(root, "a", "<packaging>jar</packaging><modules><module>../b</module></modules>");
    await writePom(root, "b", "<packaging>jar</packaging><modules><module>../a</module></modules>");

    assert.deepEqual(
      (await discoverMavenModules(root)).map((module) => module.path),
      ["a", "b"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a declared module whose pom.xml is missing", async () => {
  const root = await temporaryProject();
  try {
    await writePom(root, ".", "<packaging>pom</packaging><modules><module>missing</module></modules>");
    await mkdir(join(root, "missing"));

    await assert.rejects(
      discoverMavenModules(root),
      (error: unknown) =>
        error instanceof RuntimeError &&
        error.message === "Maven module POM is missing: missing/pom.xml",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed pom.xml", async () => {
  const root = await temporaryProject();
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "pom.xml"), "<project>");

    await assert.rejects(discoverMavenModules(root), RuntimeError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a module path that escapes the root", async () => {
  const root = await temporaryProject();
  try {
    await writePom(
      root,
      ".",
      "<packaging>pom</packaging><modules><module>../outside</module></modules>",
    );

    await assert.rejects(discoverMavenModules(root), /escapes the configuration root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a symlinked module directory", async () => {
  const root = await temporaryProject();
  const outside = await temporaryProject();
  try {
    await writePom(
      root,
      ".",
      "<packaging>pom</packaging><modules><module>linked</module></modules>",
    );
    await writePom(outside, ".", "<packaging>jar</packaging>");
    await symlink(outside, join(root, "linked"));

    await assert.rejects(discoverMavenModules(root), /symlink/);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});
