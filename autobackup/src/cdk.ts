#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AutoBackupStack} from './autobackup-stack.js';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autobackup',
      url: 'https://github.com/truemark/public/tree/main/autobackup',
    },
  },
});
new AutoBackupStack(app, 'AutoBackup', {});
