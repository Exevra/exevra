import { readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (typeof version !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
  throw new Error('package.json must contain a stable release version');
}

const paths = [
  'README.md',
  'website/src/content/docs/guides/github-action.md',
  'website/src/content/docs/guides/upgrading.md',
];
const files = await Promise.all(paths.map(async (path) => {
  const content = await readFile(path, 'utf8');
  const updated = content.replace(/Exevra\/exevra@v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/g, `Exevra/exevra@v${version}`);
  if (!content.includes('Exevra/exevra@v') || !updated.includes(`Exevra/exevra@v${version}`)) {
    throw new Error(`No versioned Action reference found in ${path}`);
  }
  return { path, updated };
}));
await Promise.all(files.map(({ path, updated }) => writeFile(path, updated)));
