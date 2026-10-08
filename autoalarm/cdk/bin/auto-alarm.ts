#!/usr/bin/env node
import 'source-map-support/register';
import {AutoAlarmStack} from '../lib/auto-alarm-stack';
import {ExtendedApp, StandardTagsProps} from 'truemark-cdk-lib/aws-cdk';

/**
 * Optional cost center and team tagging. No values are hardcoded here; they
 * are only applied when supplied via environment variables
 * (AUTOALARM_COST_CENTER / AUTOALARM_TEAM) or CDK context
 * (-c costCenter=... -c team=...). Because ExtendedApp takes standardTags at
 * construction (before app.node.tryGetContext is available), context is read
 * from the CDK_CONTEXT_JSON environment variable the CDK CLI sets for the
 * app process. See DEPLOYMENT.md for details.
 */
function optionalStandardTags(): Partial<StandardTagsProps> {
  // CDK makes -c/cdk.json context available to the process via the
  // CDK_CONTEXT_JSON environment variable before the App is constructed.
  let context: Record<string, unknown> = {};
  try {
    context = JSON.parse(process.env.CDK_CONTEXT_JSON ?? '{}');
  } catch {
    context = {};
  }

  const costCenter =
    process.env.AUTOALARM_COST_CENTER ??
    (typeof context['costCenter'] === 'string'
      ? (context['costCenter'] as string)
      : undefined);
  const team =
    process.env.AUTOALARM_TEAM ??
    (typeof context['team'] === 'string'
      ? (context['team'] as string)
      : undefined);

  return {
    ...(costCenter ? {costCenterTags: {projectName: costCenter}} : {}),
    ...(team ? {teamTags: {name: team}} : {}),
  };
}

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autoalarm',
      url: 'https://github.com/truemark/autoalarm',
    },
    ...optionalStandardTags(),
  },
});

// The prometheusWorkspaceId const is configured to take in an environment variable for the Prometheus Workspace ID which
// is then passed to our lambda to use dynamically across all environments.
const prometheusWorkspaceId = app.node.tryGetContext('prometheusWorkspaceId');
// The enableReAlarm const is configured to take in an environment variable for the enableReAlarm boolean which is then passed
// to the constructs to determine if reAlarm should be configured or not.
const useReAlarmContext = app.node.tryGetContext('EnableReAlarm');
// Ensure enableReAlarm is set to a boolean, default to `true` if not set.
const useReAlarm =
  useReAlarmContext !== undefined ? useReAlarmContext === 'true' : true;

new AutoAlarmStack(app, 'AutoAlarm', {
  prometheusWorkspaceId: prometheusWorkspaceId,
  enableReAlarm: useReAlarm,
});
