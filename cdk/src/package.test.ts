import * as fs from 'node:fs';
import * as path from 'node:path';
import {expect, test} from 'vitest';

function parse(range: string) {
  const match = /^(\^?)(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!match) {
    throw new Error(`Unsupported version range ${range}`);
  }
  return {
    caret: match[1] === '^',
    version: [Number(match[2]), Number(match[3]), Number(match[4])],
  };
}

// jsii cannot read pnpm "catalog:" specifiers, so the peer dependency ranges
// in package.json are written out by hand. This checks the versions the
// workspace catalog installs, and so the versions the tests run against, are
// still inside those ranges.
test('peerDependencies accept the versions in the pnpm catalog', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf-8'),
  );
  const workspace = fs.readFileSync(
    path.join(root, '..', 'pnpm-workspace.yaml'),
    'utf-8',
  );
  const catalog: Record<string, string> = {};
  for (const match of workspace.matchAll(/^ {2}"([^"]+)": "([^"]+)"$/gm)) {
    catalog[match[1]] = match[2];
  }
  for (const [name, range] of Object.entries<string>(pkg.peerDependencies)) {
    expect(catalog[name], `${name} is missing from the catalog`).toBeDefined();
    const peer = parse(range);
    const installed = parse(catalog[name]);
    if (!peer.caret) {
      expect(catalog[name], `pinned peer ${name}`).toEqual(range);
      continue;
    }
    const [major, minor, patch] = installed.version;
    const [peerMajor, peerMinor, peerPatch] = peer.version;
    expect(major, `major version of ${name}`).toEqual(peerMajor);
    expect(
      minor > peerMinor || (minor === peerMinor && patch >= peerPatch),
      `catalog ${catalog[name]} of ${name} is below peer range ${range}`,
    ).toBe(true);
  }
});
