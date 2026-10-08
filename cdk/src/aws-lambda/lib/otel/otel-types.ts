/**
 * Standard OpenTelemetry (OTel) configuration for Lambda.
 */
export interface OtelLambdaConfig {
  /**
   * OTel service name to be used for instrumentation.
   */
  readonly serviceName: string;

  /**
   * OTel environment name to be used for instrumentation.
   */
  readonly environmentName: string;

  /**
   * Optional: Enables or disables the OpenTelemetry (OTel) container for this service. Defaults to false.
   */
  readonly enabled?: boolean;

  /**
   * Optional: Enables or disables the OpenTelemetry (OTel) layer wrapper use. Defaults to false.
   */
  readonly useOtelWrapper?: boolean;

  /**
   * The collector or wrapper to use for the OTel (OpenTelemetry) lambda layer.
   * This allows the user to override the default layer version.
   * Defaults to the one set in the lambda implementation
   */
  readonly layerVersionArn?: string;

  /**
   * SSM Parameter content path for OTel configuration. When set, this value takes precedence over configPath.
   */
  readonly ssmConfigContentParam?: string;

  /**
   * The Cloud Watch Application Metrics Namespace.
   * This allows the publishing of metrics to cloudwatch and only when this value is set.
   * Defaults to the one set in the lambda implementation, just a placeholder and nothing is published.
   */
  readonly applicationMetricsNamespace?: string;

  /**
   * Controls the logging level of the OpenTelemetry Lambda extension itself.
   * Acceptable values are 'debug', 'info', 'warn', 'error', 'dpanic', 'panic', and 'fatal'.
   * Defaults to 'info'
   */
  readonly logLevel?: string;

  /**
   * Environment variables specific to the OTel layer when needed.
   */
  readonly environmentVariables?: Record<string, string>;
}
