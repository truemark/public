import {App, Stack} from 'aws-cdk-lib';
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import * as fs from 'fs';
import {initializeOtelConfigDataFromSSM} from './otel-collector-layer-utils';

jest.mock('aws-cdk-lib/aws-ssm', () => ({
  StringParameter: {
    valueFromLookup: jest.fn(),
  },
}));
jest.mock('fs');
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  resolve: jest.fn((...args) => args.join('/')),
}));
jest.mock('aws-cdk-lib/aws-lambda', () => ({
  LayerVersion: jest.fn(),
  Architecture: {ARM_64: 'arm64', X86_64: 'x86_64'},
  Code: {fromAsset: jest.fn()},
}));
jest.mock('aws-cdk-lib/aws-s3-assets', () => ({
  Asset: jest.fn(),
}));

describe('initializeOtelConfigDataFromSSM', () => {
  const yamlContent = `
extensions:
  sigv4auth:
    region: us-west-2

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:4317
      http:
        endpoint: 127.0.0.1:4318

processors:
  batch/traces:
    timeout: 1s
    send_batch_size: 50
  batch/metrics:
    timeout: 60s

exporters:
  awsxray:

  awsemf/application:
    namespace: \${APPLICATION_METRICS_NAMESPACE}
    dimension_rollup_option: NoDimensionRollup
    resource_to_telemetry_conversion:
      enabled: true

  prometheusremotewrite/application:
    endpoint: https://aps-workspaces.us-west-2.amazonaws.com/workspaces/ws-123456/api/v1/remote_write
    auth:
      authenticator: sigv4auth
    namespace: "adot"
    resource_to_telemetry_conversion:
      enabled: true
    external_labels:
      namespace: \${SERVICE_NAME}-lambda

service:
  telemetry:
    logs:
      level: info
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch/traces]
      exporters: [awsxray]

    metrics/application:
      receivers: [otlp]
      processors: [batch/metrics]
      exporters: [prometheusremotewrite/application, awsemf/application]

`;

  beforeEach(() => {
    jest.clearAllMocks();
    (StringParameter.valueFromLookup as jest.Mock).mockReturnValue(yamlContent);
  });

  it('replaces placeholders and extracts workspaceId', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {env: {region: 'us-west-2'}});

    const result = initializeOtelConfigDataFromSSM(
      stack,
      'TestId',
      '/app/global/otel/lambda',
      'my-service',
      'MyApp/Metrics',
    );

    expect(result.workspaceId).toBe('ws-123456');
    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).not.toContain('APPLICATION_METRICS_NAMESPACE');
    expect(writtenContent).not.toContain('SERVICE_NAME');
  });

  it('removes awsemf exporter if applicationMetricsNamespace is not provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {env: {region: 'us-west-2'}});

    initializeOtelConfigDataFromSSM(
      stack,
      'TestId',
      '/app/global/otel/lambda',
      'my-service',
      // applicationMetricsNamespace is undefined
    );

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).not.toContain('APPLICATION_METRICS_NAMESPACE');
    expect(writtenContent).not.toContain('SERVICE_NAME');
    expect(writtenContent).toContain(
      'exporters: [prometheusremotewrite/application]',
    );
  });

  it('returns undefined workspaceId if endpoint is missing', () => {
    (StringParameter.valueFromLookup as jest.Mock).mockReturnValue(
      'exporters:\n  prometheusremotewrite:\n    endpoint: none',
    );
    const app = new App();
    const stack = new Stack(app, 'TestStack', {env: {region: 'us-west-2'}});

    const result = initializeOtelConfigDataFromSSM(
      stack,
      'TestId',
      '/app/global/otel/lambda',
      'my-service',
      'MyApp/Metrics',
    );

    expect(result.workspaceId).toBeUndefined();
  });
});
