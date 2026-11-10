import {expect, test} from 'vitest';
import {tagKeys} from './tags.js';

test('tagKeys applies the default prefix', () => {
  expect(tagKeys()).toContain('database-collector:enabled');
});

test('tagKeys applies a custom prefix', () => {
  expect(tagKeys('dbc:')).toEqual([
    'dbc:enabled',
    'dbc:secret',
    'dbc:allow',
    'dbc:username',
    'dbc:database',
    'dbc:query-sets',
  ]);
});
