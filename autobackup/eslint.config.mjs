// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const config = [
  {
    ignores: [
      'cdk.out',
      'node_modules',
      'pnpm-lock.yaml',
      '**/*.js',
      '**/*.d.*',
      '**/*.map',
      '**/*.mjs',
    ],
  },
  ...tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
      rules: {
        '@typescript-eslint/no-unused-vars': 'warn',
        '@typescript-eslint/no-empty-object-type': 'warn',
      }
    }
  ),
];
export default config;
