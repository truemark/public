#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AutoSocStack} from './autosoc-stack.js';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autosoc',
      url: 'https://github.com/truemark/public/tree/main/autosoc',
    },
  },
});
new AutoSocStack(app, 'AutoSoc', {});
