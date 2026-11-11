import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {expect, test} from 'vitest';

// constructs 10 declares package exports without its lib/ files, so a deep
// import fails to resolve for consumers using moduleResolution NodeNext.
test('no source file deep-imports the constructs package', () => {
  const offenders = readdirSync(__dirname, {recursive: true, encoding: 'utf8'})
    .filter((file) => file.endsWith('.ts'))
    .filter((file) =>
      /from 'constructs\//.test(readFileSync(join(__dirname, file), 'utf8')),
    );
  expect(offenders).toEqual([]);
});
