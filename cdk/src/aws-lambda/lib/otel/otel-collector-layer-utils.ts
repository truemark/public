import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {Construct} from 'constructs';
import {
  LayerVersion,
  ILayerVersion,
  Architecture,
  Code,
} from 'aws-cdk-lib/aws-lambda';
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import {RemovalPolicy, Stack} from 'aws-cdk-lib';

export const DEFAULT_APPLICATION_METRICS_NAMESPACE = 'TrueMark/Otel';

function replacePlaceholders(
  yamlContent: string,
  values: Record<string, string>,
): string {
  return yamlContent.replace(/\$\{([^}]+)\}/g, (_, key) => {
    if (key in values) {
      return values[key];
    }
    return `$\{${key}}`;
  });
}

function removeUnwantedExporter(
  exporterName: string,
  yamlContent: string,
): string {
  return yamlContent.replace(
    /^(\s*exporters:\s*\[)([^\]]*)(\])/gm,
    (_match, prefix, listContent, suffix) => {
      const entries = listContent
        .split(',')
        .map((exporterEntry: string) => exporterEntry.trim());
      const filtered = entries.filter(
        (entryToFilter: string) => !entryToFilter.startsWith(exporterName),
      );
      return `${prefix}${filtered.join(', ')}${suffix}`;
    },
  );
}

export function initializeOtelConfigDataFromSSM(
  scope: Construct,
  id: string,
  parameterName: string,
  serviceName: string,
  applicationMetricsNamespace?: string,
): {otelSsmCollectorConfigLayer: ILayerVersion; workspaceId?: string} {
  const stack = Stack.of(scope);
  const ssmValue = StringParameter.valueFromLookup(stack, parameterName);

  let workspaceId: string | undefined;
  const match = ssmValue.match(/endpoint:\s*(https?:\/\/[^\s]+)/);
  if (match) {
    const endpoint = match[1];
    const workspaceIdMatch = endpoint.match(/\/workspaces\/(ws-[\w-]+)/);
    if (workspaceIdMatch) {
      workspaceId = workspaceIdMatch[1];
    }
  }

  // Replace placeholders in the YAML content
  const replacements = {
    APPLICATION_METRICS_NAMESPACE:
      applicationMetricsNamespace ?? DEFAULT_APPLICATION_METRICS_NAMESPACE,
    SERVICE_NAME: serviceName,
  };
  const collectorYmlContent = replacePlaceholders(ssmValue, replacements);

  // Prepare temp layer folder
  const layerRoot = join(__dirname, `.layer-${id}`);
  const layerPath = join(layerRoot, 'collector-layer', 'collector.yaml');
  const layerNodejsPath = join(layerRoot, 'collector-layer');

  const updatedCollectorYmlContent = applicationMetricsNamespace
    ? collectorYmlContent
    : removeUnwantedExporter('awsemf', collectorYmlContent);

  mkdirSync(layerNodejsPath, {recursive: true});
  writeFileSync(layerPath, updatedCollectorYmlContent);

  const otelSsmCollectorConfigLayer = new LayerVersion(
    scope,
    `${id}CollectorLayer`,
    {
      compatibleArchitectures: [Architecture.ARM_64],
      code: Code.fromAsset(layerNodejsPath),
      description: `Collector.yaml layer from SSM param: ${parameterName}`,
      removalPolicy: RemovalPolicy.DESTROY,
    },
  );

  return {otelSsmCollectorConfigLayer, workspaceId};
}
