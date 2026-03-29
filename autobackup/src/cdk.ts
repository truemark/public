#!/usr/bin/env node
import {AutoBackupStack} from './autobackup-stack.js';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autobackup',
      url: 'https://github.com/truemark/public/tree/main/autobackup',
    },
  },
});
new AutoBackupStack(app, 'AutoBackup', {});
