/**
 * Drift guard for cdk/lib/service-tag-keys.ts.
 *
 * The CDK package is CommonJS and cannot import the ESM (.mts) handler
 * sources through tsc, so the changed-tag-keys lists are materialized in
 * service-tag-keys.ts. This test loads the REAL alarm-config arrays from
 * handlers/src/alarm-configs (bundled on the fly with esbuild) and asserts
 * each CDK-side list is exactly:
 *
 *   ['autoalarm:enabled', ...CONFIGS.map((c) => `autoalarm:${c.tagKey}`),
 *    ...NON_CONFIG_TAG_KEYS[service] ?? []]
 *
 * Adding, removing, renaming, or reordering a tagKey in the handlers
 * configs without updating service-tag-keys.ts fails this test (and CI).
 */
import * as path from 'path';
import {createRequire} from 'module';
import {buildSync} from 'esbuild';
import {
  NON_CONFIG_TAG_KEYS,
  SERVICE_TAG_KEYS,
  TagRuleService,
} from './service-tag-keys';

const HANDLERS_CONFIG_INDEX = path.resolve(
  __dirname,
  '..',
  '..',
  'handlers',
  'src',
  'alarm-configs',
  '_index.mts',
);

/**
 * Maps each service with a tag-change rule to its *_CONFIGS export in
 * handlers/src/alarm-configs/_index.mts.
 */
const CONFIG_EXPORTS: Record<TagRuleService, string> = {
  alb: 'ALB_CONFIGS',
  cloudfront: 'CLOUDFRONT_CONFIGS',
  ec2: 'EC2_CONFIGS',
  lambda: 'LAMBDA_CONFIGS',
  opensearch: 'OPENSEARCH_CONFIGS',
  rds: 'RDS_CONFIGS',
  rdscluster: 'RDS_CLUSTER_CONFIGS',
  route53resolver: 'ROUTE53_RESOLVER_CONFIGS',
  sfn: 'STEP_FUNCTION_CONFIGS',
  targetgroup: 'TARGET_GROUP_CONFIGS',
  transitgateway: 'TRANSIT_GATEWAY_CONFIGS',
  vpn: 'VPN_CONFIGS',
};

interface AlarmConfigLike {
  tagKey: string;
}

/**
 * Bundles the handlers alarm-config barrel to CommonJS in memory and
 * evaluates it. Third-party packages (only used for enum values in the
 * config defaults) stay external and are resolved from handlers'
 * node_modules via createRequire.
 */
function loadHandlerAlarmConfigs(): Record<string, AlarmConfigLike[]> {
  const result = buildSync({
    entryPoints: [HANDLERS_CONFIG_INDEX],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['@aws-sdk/*', 'aws-cdk-lib', 'aws-cdk-lib/*'],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const handlersRequire = createRequire(HANDLERS_CONFIG_INDEX);
  const moduleShim = {exports: {} as Record<string, AlarmConfigLike[]>};
  new Function('module', 'exports', 'require', code)(
    moduleShim,
    moduleShim.exports,
    handlersRequire,
  );
  return moduleShim.exports;
}

describe('service-tag-keys stays in sync with handlers alarm configs', () => {
  const handlerConfigs = loadHandlerAlarmConfigs();

  for (const [service, exportName] of Object.entries(CONFIG_EXPORTS) as [
    TagRuleService,
    string,
  ][]) {
    test(`${service} changed-tag-keys are derived from ${exportName}`, () => {
      const configs = handlerConfigs[exportName];
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);

      const derived = [
        'autoalarm:enabled',
        ...configs.map((config) => `autoalarm:${config.tagKey}`),
        ...(NON_CONFIG_TAG_KEYS[service] ?? []),
      ];

      expect(SERVICE_TAG_KEYS[service]).toEqual(derived);
    });
  }
});
