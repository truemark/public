#!/usr/bin/env node
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {AutoFimStack, type SecurityHubSeverityLabel} from './autofim-stack.js';

function ctxString(app: ExtendedApp, key: string): string | undefined {
  const raw = app.node.tryGetContext(key);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autofim',
      url: 'https://github.com/truemark/public/tree/main/autofim',
    },
  },
});

const monitoredPath = ctxString(app, 'fimMonitoredPath');
const criticalFilePatterns = ctxString(app, 'fimCriticalFilePatterns');
if (!monitoredPath) {
  throw new Error(
    'AutoFimStack requires `-c fimMonitoredPath=<path>` (e.g. /etc/paymentapp/)',
  );
}
if (!criticalFilePatterns) {
  throw new Error(
    'AutoFimStack requires `-c fimCriticalFilePatterns=<regex[,regex...]>`',
  );
}

new AutoFimStack(app, 'AutoFim', {
  monitoredPath,
  criticalFilePatterns,
  // Cast is safe: AutoFimStack validates the raw string against
  // VALID_SEVERITY_LABELS at construction time and throws a clear error
  // if a `-c fimFindingSeverity=...` CLI value isn't one of Security
  // Hub's five allowed ASFF Severity.Label literals.
  findingSeverity: ctxString(app, 'fimFindingSeverity') as
    | SecurityHubSeverityLabel
    | undefined,
  inventorySchedule: ctxString(app, 'fimInventorySchedule'),
  inventoryTagKey: ctxString(app, 'fimInventoryTagKey'),
  inventoryTagValue: ctxString(app, 'fimInventoryTagValue'),
});
