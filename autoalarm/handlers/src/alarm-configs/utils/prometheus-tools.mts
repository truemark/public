import * as logging from '@nr1e/logging';
import {
  AmpClient,
  CreateRuleGroupsNamespaceCommand,
  DeleteRuleGroupsNamespaceCommand,
  DescribeRuleGroupsNamespaceCommand,
  DescribeWorkspaceCommand,
  DescribeWorkspaceCommandInput,
  ListRuleGroupsNamespacesCommand,
  PutRuleGroupsNamespaceCommand,
  RuleGroupsNamespaceStatusCode,
  RuleGroupsNamespaceSummary,
} from '@aws-sdk/client-amp';
import {
  AlarmClassification,
  AMPRule,
  EC2AlarmManagerArray,
  NamespaceDetails,
  PrometheusAlarmConfigArray,
  RuleGroup,
} from '../../types/index.mjs';
import {
  EC2getCpuQuery,
  EC2getMemoryQuery,
  EC2getStorageQuery,
} from './index.mjs';
import * as yaml from 'js-yaml';
import * as aws4 from 'aws4'; // TODO: This package is deprecated. Refactor.
import * as https from 'https';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {defaultProvider} from '@aws-sdk/credential-provider-node';
import {buildAlarmName, parseMetricAlarmOptions} from './index.mjs';
import * as AlarmConfigs from '../_index.mjs';

const log: logging.Logger = logging.getLogger('ec2-modules');
// Keep the SDK-level retries modest: these calls are also wrapped in
// retryWithExponentialBackoff, so a large SDK retry count multiplies the
// total retry time.
const retryStrategy = new ConfiguredRetryStrategy(
  5,
  (attempt: number) => 100 + attempt * 1000,
);
//the following environment variables are used to get the prometheus workspace id and the region
const region = process.env.AWS_REGION;
const client = new AmpClient({
  region,
  credentials: defaultProvider(),
  retryStrategy: retryStrategy,
});

/*
 * Exponential backoff retry helper function. This is used because the built-in aws retry strategy doesn't work in this
 * context as failed calls during update.
 * first delay starts at 5 seconds and then increments by 5 seconds for each iteration.
 */
async function retryWithExponentialBackoff(
  fn: () => Promise<void>,
  maxRetries = 3,
  initialDelay = 5000, // Initial delay in milliseconds (5 seconds)
  delayIncrement = 5000, // Incremental delay in milliseconds (5 seconds)
) {
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      await fn();
      return; // Exit if the function succeeds
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        log
          .error()
          .str('function', 'retryWithExponentialBackoff')
          .err(error)
          .msg('Exceeded maximum retries');
        throw error; // Rethrow after exceeding retries
      }

      const delay = initialDelay + delayIncrement * (attempt - 1);
      log
        .warn()
        .str('function', 'retryWithExponentialBackoff')
        .num('attempt', attempt)
        .num('delay', delay)
        .err(error)
        .msg('Retrying after error.');

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * This function is used to delete all prom rules in batch for instances that have been marked for Prom rule deletion.
 * @param prometheusWorkspaceId - The prometheus workspace id.
 * @param ec2AlarmManagerArray - Array of EC2 instances with state and tags.
 * @param service - The service name.
 */

export async function batchPromRulesDeletion(
  prometheusWorkspaceId: string,
  ec2AlarmManagerArray: EC2AlarmManagerArray,
  service: string,
) {
  log
    .info()
    .str('function', 'batchPromRulesDeletion')
    .msg('Prometheus rules have been marked for deletion. Fetching instances.');

  try {
    // Using the passed EC2AlarmManagerArray instead of fetching instances
    const instancesToDelete = ec2AlarmManagerArray
      .filter((details) => {
        const baseCondition =
          details.tags['autoalarm:target'] === 'cloudwatch' ||
          details.tags['autoalarm:enabled'] === 'false';
        const isTerminating = ['terminated'].includes(details.state);

        return (
          baseCondition || (details.tags['autoalarm:enabled'] && isTerminating)
        );
      })
      .map((details) => details.instanceID);

    log
      .info()
      .str('function', 'batchPromRulesDeletion')
      .str('instancesToDelete', JSON.stringify(instancesToDelete))
      .msg('Instances to delete Prometheus rules for');

    if (instancesToDelete.length > 0) {
      // Delete Prometheus rules for all relevant instances at once
      await retryWithExponentialBackoff(async () =>
        deletePromRulesForService(
          prometheusWorkspaceId,
          service,
          instancesToDelete,
        ),
      );
      log
        .info()
        .str('function', 'batchPromRulesDeletion')
        .msg(
          'Prometheus rules deleted successfully in batch or no rules to delete',
        );
    } else {
      log
        .info()
        .str('function', 'batchPromRulesDeletion')
        .msg('No instances found to delete Prometheus rules for');
    }
  } catch (error) {
    log
      .error()
      .str('function', 'batchPromRulesDeletion')
      .err(error)
      .msg('Error deleting Prometheus rules.');
    // Rethrow so callers don't treat failed deletions as success and leave
    // stale Prometheus rules behind (e.g. for terminated instances).
    throw error;
  }
}

/**
 * Get alarm configurations for Prometheus alarms for EC2 instances based on their tags and metric configurations.
 * @param ec2AlarmManagerArray - Array of EC2 instances with state and tags.
 * @param service - The service name: 'EC2', 'ECS', 'EKS', 'RDS', etc. These correspond with service names in the AlarmConfigs object from alarm-config.mts.
 * @returns Array of Prometheus alarm configurations.
 */
//TODO: Update this to use the correct service configs as more services are added to Prometheus
async function getPromAlarmConfigs(
  ec2AlarmManagerArray: EC2AlarmManagerArray,
  service: string,
): Promise<PrometheusAlarmConfigArray> {
  const configs: PrometheusAlarmConfigArray = [];
  // Loop through each instance in the ec2AlarmManagerArray
  for (const {instanceID, tags, ec2Metadata} of ec2AlarmManagerArray) {
    const platform = ec2Metadata?.platform ?? '';
    const privateIP = ec2Metadata?.privateIP ?? '';

    if (!privateIP) {
      log
        .error()
        .str('function', 'getPromAlarmConfigs')
        .str('instanceId', instanceID)
        .msg('Private IP address not found for instance');
      continue; // Skip this instance if no private IP
    }

    const escapedPrivateIp = privateIP.replace(/\./g, '\\\\.');

    // Loop through each metric configuration
    for (const config of AlarmConfigs.EC2_CONFIGS) {
      log
        .info()
        .str('function', 'getPromAlarmConfigs')
        .str('service', service)
        .str('config', JSON.stringify(config))
        .msg('Processing metric configuration');
      const tagValue = tags[`autoalarm:${config.tagKey}`];
      const updatedDefaults = parseMetricAlarmOptions(
        tagValue || '',
        config.defaults,
      );
      log
        .info()
        .str('function', 'getPromAlarmConfigs')
        .str('service', service)
        .str('updatedDefaults', JSON.stringify(updatedDefaults))
        .msg('Updated defaults for metric configuration');

      // Determine if the alarm should be created based on defaultCreate or tag presence
      if (config.defaultCreate || tagValue !== undefined) {
        const classifications = ['Warning', 'Critical'];
        for (const classification of classifications) {
          const threshold =
            classification === 'Warning'
              ? updatedDefaults.warningThreshold
              : updatedDefaults.criticalThreshold;

          if (threshold === null || threshold === undefined) {
            // Skip if threshold is not set
            continue;
          }

          // Determine the duration
          const durationTime =
            updatedDefaults.period * updatedDefaults.evaluationPeriods;

          // Build the Prometheus query
          let alarmQuery = '';

          switch (config.tagKey) {
            case 'cpu':
              alarmQuery = EC2getCpuQuery(
                platform,
                escapedPrivateIp,
                instanceID,
                threshold,
              );
              break;
            case 'memory':
              alarmQuery = EC2getMemoryQuery(
                platform,
                escapedPrivateIp,
                instanceID,
                threshold,
              );
              break;
            case 'storage':
              alarmQuery = EC2getStorageQuery(
                platform,
                escapedPrivateIp,
                instanceID,
                threshold,
              );
              break;
            // Add more cases for additional metrics as needed
            default:
              break;
          }

          if (!alarmQuery) {
            // Skip if alarmQuery couldn't be constructed
            continue;
          }

          /**
           * The shared EC2 memory/storage configs ship with an empty
           * metricName (it is platform-resolved for CloudWatch alarms in
           * ec2-modules). Resolve a distinct, non-empty metric name on a local
           * copy here so Prometheus rule names are unique and never contain an
           * empty segment. The Prometheus path is node_exporter/Linux based,
           * so use the Linux CloudWatch agent metric names. Never mutate the
           * shared config objects.
           */
          const resolvedConfig =
            config.metricName === ''
              ? {
                  ...config,
                  metricName: config.tagKey.includes('memory')
                    ? 'mem_used_percent'
                    : 'disk_used_percent',
                }
              : config;

          // Build the alarm name based on the convention
          const alarmName = buildAlarmName(
            resolvedConfig,
            service,
            instanceID,
            classification as AlarmClassification,
            'static',
          );

          // Push the alarm configuration into the array
          configs.push({
            instanceId: instanceID,
            type: classification,
            alarmName, // Include the alarm name
            alarmQuery,
            duration: `${Math.floor(durationTime / 60)}m`, // Convert duration to minutes
            severityType: classification.toLowerCase(),
          });
        }
      }
    }
  }
  log
    .info()
    .str('function', 'getPromAlarmConfigs')
    .str('service', service)
    .str('configs', JSON.stringify(configs))
    .msg('Prometheus alarm configurations generated');
  return configs;
}

// TODO: Need to add back retry logic to batchUpdatePromRules wait 30 seconds for 5 tries.

/**
 * Batch update Prometheus rules for all EC2 instances with the necessary tags and metrics reporting.
 * @param prometheusWorkspaceId - The Prometheus workspace ID.
 * @param service - The service name.
 * @param ec2AlarmManagerArray - Array of EC2 instances with state and tags.
 */
export async function batchUpdatePromRules(
  prometheusWorkspaceId: string,
  service: string,
  ec2AlarmManagerArray: EC2AlarmManagerArray,
) {
  log
    .info()
    .str('function', 'batchUpdatePromRules')
    .msg('Fetching instance details and tags');

  try {
    const alarmConfigs: PrometheusAlarmConfigArray = [];
    const configs: PrometheusAlarmConfigArray = await getPromAlarmConfigs(
      ec2AlarmManagerArray,
      service,
    );
    alarmConfigs.push(...configs);

    log
      .info()
      .str('function', 'batchUpdatePromRules')
      .str('alarmConfigs', JSON.stringify(alarmConfigs))
      .msg('Consolidated alarm configurations');

    const namespace = `AutoAlarm-${service.toUpperCase()}`;
    const ruleGroupName = 'AutoAlarm';

    log
      .info()
      .str('function', 'batchUpdatePromRules')
      .msg(
        `Updating Prometheus rules for all instances in batch under namespace: ${namespace}`,
      );

    await retryWithExponentialBackoff(async () =>
      managePromNamespaceAlarms(
        prometheusWorkspaceId,
        namespace,
        ruleGroupName,
        alarmConfigs,
      ),
    );

    log
      .info()
      .str('function', 'batchUpdatePromRules')
      .msg('Batch update of Prometheus rules completed.');
  } catch (error) {
    log
      .error()
      .str('function', 'batchUpdatePromRules')
      .err(error)
      .msg('Error during batch update of Prometheus rules');
    throw new Error(`Error during batch update of Prometheus rules: ${error}`);
  }
}

// We use the following const to make a signed http request for the prom APIs following patterns found in this example:
// https://github.com/aws-samples/sigv4-signing-examples/blob/main/sdk/nodejs/main.js. We use defaultProvider to get the
// credentials needed to sign the request. We then sign the request using aws4 and make the request using https.request.
export const makeSignedRequest = async (
  path: string,
  region: string,
  // TODO Fix the use of any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  const hostname = `aps-workspaces.${region}.amazonaws.com`;

  // Fetch credentials using the default provider
  const credentials = await defaultProvider()();

  // Define the request options
  const options = {
    hostname,
    path,
    method: 'GET',
    headers: {
      'host': hostname,
      'Content-Type': 'application/json',
    },
  };

  // Sign the request using aws4
  const signer = aws4.sign(
    {
      service: 'aps',
      region: region,
      path: path,
      headers: options.headers,
      method: options.method,
      body: '',
    },
    {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  );

  // Add signed headers to the request options
  Object.assign(options.headers, signer.headers);
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        log
          .info()
          .str('function', 'makeSignedRequest')
          .num('statusCode', res.statusCode || 0)
          .msg('Response received');

        try {
          const parsedData = JSON.parse(data);
          log
            .info()
            .str('function', 'makeSignedRequest')
            .num('statusCode', res.statusCode || 0)
            .str('parsedData', JSON.stringify(parsedData, null, 2))
            .msg('Parsed response data');
          resolve(parsedData);
        } catch (error) {
          log
            .error()
            .str('function', 'makeSignedRequest')
            .num('statusCode', res.statusCode || 0)
            .err(error)
            .str('rawData', data)
            .msg('Failed to parse response data');
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      log
        .error()
        .str('function', 'makeSignedRequest')
        .err(error)
        .msg('Request error');
      reject(error);
    });

    req.end();
  });
};

/**
 * This function uses case switching to dynamically check that aws managed prometheus is receiving data from a service.
 * cases are ec2, ecs, eks, rds, etc <--- add more cases as needed and make note here in this comment. All Lower case.
 * ec2 service identifier is the instance private IP address.
 * ecs service identifier is...
 * eks service identifier is...
 * rds service identifier is...
 * QueryMetrics API documentation can be found here: https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-APIReference-QueryMetrics.html
 * @param serviceType - The type of service (e.g., 'ec2').
 * @param promWorkspaceID - The Prometheus workspace ID.
 * @param region - The AWS region.
 * @returns Promise resolving to Prometheus query result.
 */
export async function queryPrometheusForService(
  serviceType: string,
  promWorkspaceID: string,
  region: string,
): Promise<string[]> {
  const queryPath = `/workspaces/${promWorkspaceID}/api/v1/query?query=`;

  try {
    let query = '';
    switch (serviceType) {
      case 'ec2': {
        // Log the initial function call details
        log
          .info()
          .str('function', 'queryPrometheusForService')
          .str('serviceType', serviceType)
          .str('promWorkspaceID', promWorkspaceID)
          .str('region', region)
          .msg('Querying Prometheus for EC2 instances');

        // TODO: DevOps to potentially add job label back but we may need to use go_info for the query
        // query = 'up{job="ec2"}';
        // Define the query to use go_info metric
        query = 'go_info';
        const response = await makeSignedRequest(
          queryPath + encodeURIComponent(query),
          region,
        );

        // Log the raw Prometheus query result
        log
          .info()
          .str('function', 'queryPrometheusForService')
          .str('serviceType', serviceType)
          .str('Prometheus Workspace ID', promWorkspaceID)
          .str('region', region)
          .str('response', JSON.stringify(response, null, 2))
          .msg('Raw Prometheus query result');

        // Check for a successful response structure
        if (
          !response ||
          response.status !== 'success' ||
          !response.data ||
          !response.data.result
        ) {
          // Log a warning if the query failed or returned an unexpected structure
          log
            .warn()
            .str('function', 'queryPrometheusForService')
            .str('serviceType', serviceType)
            .str('Prometheus Workspace ID', promWorkspaceID)
            .str('response', JSON.stringify(response, null, 2))
            .msg('Prometheus query failed or returned unexpected structure.');
          return [];
        }

        const instances: string[] = [];

        /*
         * Regex for matching IP address:port
         * this may be unnecessary as the instance ID is also returned in the query and a single query can have multiple IPs
         * we may need to rework the logic here to deliver an object that has the instanceID associated with the private IP: {instanceID: privateIP}
         */
        const ipPortRegex = /(\d{1,3}\.){3}\d{1,3}:\d+$/;
        // Regex for matching AWS EC2 instance ID
        const ec2InstanceIdRegex = /^i-[a-zA-Z0-9]+$/;

        // Extract unique instances private IPs or instance IDs from query results
        // TODO Fix the use of any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response.data.result.forEach((item: any) => {
          const instanceID = item.metric.instance;

          // Log the instance being processed
          log
            .info()
            .str('function', 'queryPrometheusForService')
            .str('instance', instanceID)
            .msg('Processing instance from Prometheus response');

          if (ipPortRegex.test(instanceID)) {
            const ip = instanceID.split(':')[0];
            instances.push(ip);
            // Log the matched IP address
            log
              .info()
              .str('function', 'queryPrometheusForService')
              .str('ip', ip)
              .msg('Matched IP address');
          } else if (ec2InstanceIdRegex.test(instanceID)) {
            instances.push(instanceID);
            // Log the matched EC2 instance ID
            log
              .info()
              .str('function', 'queryPrometheusForService')
              .str('instanceId', instanceID)
              .str('Prometheus Workspace ID', promWorkspaceID)
              .obj('response', response)
              .msg('Matched EC2 instance ID');
          } else {
            // Log a warning if the instance did not match any regex patterns
            log
              .warn()
              .str('function', 'queryPrometheusForService')
              .str('instance', instanceID)
              .msg('Instance did not match any regex patterns');
          }
        });

        // Log the unique instances extracted from the Prometheus response
        log
          .info()
          .str('function', 'queryPrometheusForService')
          .str('serviceType', serviceType)
          .str('Prometheus Workspace ID', promWorkspaceID)
          .obj('instances', instances)
          .msg('Unique instances extracted from Prometheus response');

        return instances;
      }
      default: {
        // Log a warning if an unsupported service type is provided
        log
          .warn()
          .str('function', 'queryPrometheusForService')
          .str('serviceType', serviceType)
          .msg('Unsupported service type.');
        return [];
      }
    }
  } catch (error) {
    // Log an error if there was an issue querying Prometheus
    log
      .error()
      .err(error)
      .str('function', 'queryPrometheusForService')
      .str('serviceType', serviceType)
      .str('Prometheus Workspace ID', promWorkspaceID)
      .str('region', region)
      .msg('Error querying Prometheus');
    return [];
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Errors that will never succeed on retry and should be rethrown immediately.
const nonRetryableListErrors = ['AccessDeniedException', 'ValidationException'];

// Function to list namespaces. Paginates via nextToken so all namespaces are
// returned (the 2000-rule guard depends on a complete count) and retries
// transient errors a bounded number of times instead of recursing forever.
const listNamespaces = async (
  workspaceId: string,
): Promise<RuleGroupsNamespaceSummary[]> => {
  log.info().str('workspaceId', workspaceId).msg('Listing namespaces');
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const namespaces: RuleGroupsNamespaceSummary[] = [];
      let nextToken: string | undefined;
      do {
        const response = await client.send(
          new ListRuleGroupsNamespacesCommand({workspaceId, nextToken}),
        );
        namespaces.push(...(response.ruleGroupsNamespaces ?? []));
        nextToken = response.nextToken;
      } while (nextToken);

      log
        .info()
        .num('namespaceCount', namespaces.length)
        .msg('Successfully listed namespaces');
      return namespaces;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      if (nonRetryableListErrors.includes(errorName)) {
        log
          .error()
          .err(error)
          .msg('Non-retryable error listing namespaces. Not retrying.');
        throw error;
      }
      if (attempt >= maxAttempts) {
        log
          .error()
          .err(error)
          .num('attempt', attempt)
          .msg('Error listing namespaces. Exceeded maximum retries.');
        throw error;
      }
      log
        .warn()
        .err(error)
        .num('attempt', attempt)
        .msg('Error listing namespaces. Retrying.');
      await wait(5000); // Wait for 5 seconds before retrying
    }
  }

  // Unreachable: the loop either returns or throws.
  return [];
};

// Function to describe a namespace
export const describeNamespace = async (
  workspaceId: string,
  namespace: string,
): Promise<NamespaceDetails | null> => {
  const command = new DescribeRuleGroupsNamespaceCommand({
    workspaceId,
    name: namespace,
  });
  log
    .info()
    .str('function', 'describeNamespace')
    .str('workspaceId', workspaceId)
    .str('namespace', namespace)
    .msg('Describing namespace');

  try {
    const response = await client.send(command);
    if (response.ruleGroupsNamespace) {
      const dataStr = new TextDecoder().decode(
        response.ruleGroupsNamespace.data,
      );
      log
        .info()
        .str('function', 'describeNamespace')
        .str('rawData', dataStr)
        .msg('Raw data from API');
      try {
        const nsDetails = yaml.load(dataStr) as NamespaceDetails;
        if (!isNamespaceDetails(nsDetails)) {
          throw new Error('Invalid namespace details structure');
        }
        log
          .info()
          .str('function', 'describeNamespace')
          .str('namespace', namespace)
          .str('details', JSON.stringify(nsDetails))
          .msg('Namespace described');
        return nsDetails;
      } catch (parseError) {
        log
          .error()
          .str('function', 'describeNamespace')
          .err(parseError)
          .str('rawData', dataStr)
          .msg('Failed to parse namespace data');
        throw parseError;
      }
    }
    log
      .warn()
      .str('function', 'describeNamespace')
      .str('namespace', namespace)
      .msg('No data returned for namespace');
    return null;
  } catch (error) {
    log
      .error()
      .str('function', 'describeNamespace')
      .err(error)
      .msg('Error describing namespace');
    return null; // Ensure that the function always returns a value
  }
};

// Function to create a new namespace
async function createNamespace(
  promWorkspaceId: string,
  namespace: string,
  // TODO Fix the use of any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  alarmConfigs: any[],
) {
  log
    .info()
    .str('function', 'createNamespace')
    .str('promWorkspaceId', promWorkspaceId)
    .str('namespace', namespace)
    .msg('Creating new Prometheus namespace with rules');

  const nsDetails = {
    groups: [
      {
        name: 'AutoAlarm',
        rules: alarmConfigs.map((config) => ({
          alert: config.alarmName,
          expr: config.alarmQuery,
          for: config.duration,
          labels: {severity: config.severityType},
          annotations: {
            summary: `${config.alarmName} alert triggered`,
            description: 'The alert was triggered based on the specified query',
          },
        })),
      },
    ],
  };

  const updatedYaml = yaml.dump(nsDetails);
  const updatedData = new TextEncoder().encode(updatedYaml);

  const input = {
    workspaceId: promWorkspaceId,
    name: namespace,
    data: updatedData,
  };

  try {
    const command = new CreateRuleGroupsNamespaceCommand(input);
    await client.send(command);
    log
      .info()
      .str('function', 'createNamespace')
      .str('namespace', namespace)
      .msg('Created new namespace and added rules');
  } catch (error) {
    log
      .error()
      .str('function', 'createNamespace')
      .err(error)
      .msg('Failed to create namespace');
    // Rethrow so callers don't treat a failed create as success and silently
    // drop every rule (e.g. ConflictException on a concurrent create).
    throw error;
  }
}

/**
 * Polls DescribeRuleGroupsNamespace until the namespace reaches ACTIVE status.
 * Replaces fixed sleeps after namespace creation so we only wait as long as
 * AMP actually needs.
 * @param promWorkspaceId - The Prometheus workspace ID.
 * @param namespace - The namespace name.
 * @param pollIntervalMs - How often to poll (default 5 seconds).
 * @param timeoutMs - Maximum time to wait before failing (default 120 seconds).
 */
async function waitForNamespaceActive(
  promWorkspaceId: string,
  namespace: string,
  pollIntervalMs = 5000,
  timeoutMs = 120000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await client.send(
        new DescribeRuleGroupsNamespaceCommand({
          workspaceId: promWorkspaceId,
          name: namespace,
        }),
      );
      const statusCode = response.ruleGroupsNamespace?.status?.statusCode;

      if (statusCode === RuleGroupsNamespaceStatusCode.ACTIVE) {
        log
          .info()
          .str('function', 'waitForNamespaceActive')
          .str('namespace', namespace)
          .msg('Namespace is active');
        return;
      }

      if (
        statusCode === RuleGroupsNamespaceStatusCode.CREATION_FAILED ||
        statusCode === RuleGroupsNamespaceStatusCode.UPDATE_FAILED
      ) {
        log
          .error()
          .str('function', 'waitForNamespaceActive')
          .str('namespace', namespace)
          .str('statusCode', statusCode)
          .msg('Namespace entered a failed state');
        throw new Error(
          `Namespace ${namespace} entered failed state: ${statusCode}`,
        );
      }

      log
        .info()
        .str('function', 'waitForNamespaceActive')
        .str('namespace', namespace)
        .str('statusCode', statusCode ?? 'unknown')
        .msg('Namespace not active yet. Waiting before polling again.');
    } catch (error) {
      // The namespace may not be visible immediately after creation. Keep
      // polling on ResourceNotFoundException; rethrow anything else.
      if (
        !(error instanceof Error) ||
        error.name !== 'ResourceNotFoundException'
      ) {
        throw error;
      }
      log
        .info()
        .str('function', 'waitForNamespaceActive')
        .str('namespace', namespace)
        .msg('Namespace not found yet. Waiting before polling again.');
    }

    await wait(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for namespace ${namespace} to become active after ${timeoutMs}ms`,
  );
}

// Helper function to ensure that the object is a NamespaceDetails interface
function isNamespaceDetails(obj: unknown): obj is NamespaceDetails {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'groups' in obj &&
    Array.isArray((obj as NamespaceDetails).groups)
  );
}

// This function is used to verify that a workspace exists and is active.
async function verifyPromWorkspace(promWorkspaceId: string) {
  // we have to cast our promWorkspaceId to the DescribeWorkspaceCommandInput type in order to query for the workspace
  const input: DescribeWorkspaceCommandInput = {
    workspaceId: promWorkspaceId,
  };
  const command = new DescribeWorkspaceCommand(input);
  const verifyWorkspace = await client.send(command);
  if (!verifyWorkspace) {
    log
      .warn()
      .str('function', 'deletePromRulesForService')
      .str('promWorkspaceId', promWorkspaceId)
      .msg('Invalid or empty workspace details. Nothing to delete.');
    return;
  } else {
    log
      .info()
      .str('function', 'verifyPromWorkspace')
      .str('promWorkspaceId', promWorkspaceId)
      .obj('workspace', verifyWorkspace)
      .msg('Workspace exists and is active');
    return verifyWorkspace;
  }
}

/**
 * Function to manage Prometheus namespace alarms.
 * @param promWorkspaceId - The Prometheus workspace ID.
 * @param namespace - The namespace name.
 * @param ruleGroupName - The rule group name.
 * @param alarmConfigs - Array of alarm configurations.
 */
export async function managePromNamespaceAlarms(
  promWorkspaceId: string,
  namespace: string,
  ruleGroupName: string,
  // TODO Fix the use of any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  alarmConfigs: any[],
) {
  log
    .info()
    .str('function', 'managePromNamespaceAlarms')
    .str('promWorkspaceId', promWorkspaceId)
    .str('namespace', namespace)
    .str('ruleGroupName', ruleGroupName)
    .msg(
      'Starting managePromNamespaceAlarms and checking if workspace exists...',
    );

  // TODO Fix the use of any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspaceDescription: any = await verifyPromWorkspace(promWorkspaceId);
  if (!workspaceDescription) {
    log
      .error()
      .str('function', 'managePromNamespaceAlarms')
      .str('promWorkspaceId', promWorkspaceId)
      .msg('Invalid or empty workspace details. Halting Prometheus logic.');
    throw new Error(
      'Invalid or empty workspace details. Halting Prometheus logic.',
    );
  }

  // List all existing namespaces and count total rules
  const namespaces = await listNamespaces(promWorkspaceId);
  log
    .info()
    .str('function', 'managePromNamespaceAlarms')
    .num('totalNamespaces', namespaces.length)
    .str('namespace', namespace)
    .msg('Retrieved namespaces');

  // Describe all namespaces with bounded concurrency to avoid throttling on
  // workspaces that have many namespaces (each DescribeRuleGroupsNamespace call
  // counts against the AMP API rate limit).
  const DESCRIBE_CONCURRENCY = 5;
  const describedNamespaces: Array<{
    name: string;
    details: NamespaceDetails | null;
  }> = [];
  for (let i = 0; i < namespaces.length; i += DESCRIBE_CONCURRENCY) {
    const batch = namespaces.slice(i, i + DESCRIBE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (ns) => ({
        name: ns.name as string,
        details: await describeNamespace(promWorkspaceId, ns.name as string),
      })),
    );
    describedNamespaces.push(...results);
  }

  let totalWSRules = 0;
  // Count total rules across all namespaces
  for (const {details} of describedNamespaces) {
    if (details && isNamespaceDetails(details)) {
      // Add the number of rules in the current namespace to the total count
      totalWSRules += details.groups.reduce(
        (count, group) => count + group.rules.length,
        0,
      );
    }
  }
  log
    .info()
    .str('function', 'managePromNamespaceAlarms')
    .num('totalWSRules', totalWSRules)
    .msg('Total rules in workspace');

  // Check if total rules for workspace has less than 2000 rules
  if (totalWSRules >= 2000) {
    log
      .error()
      .str('function', 'managePromNamespaceAlarms')
      .msg('The workspace has 2000 or more rules. Halting Prometheus logic.');
    throw new Error(
      'The workspace has 2000 or more rules. Halting and falling back to CW Alarms.',
    );
  }

  // Check if the namespace exists
  const specificNamespace = namespaces.find((ns) => ns.name === namespace);

  if (!specificNamespace) {
    log
      .info()
      .str('function', 'managePromNamespaceAlarms')
      .msg(`No ${namespace} namespace found. Creating a new namespace.`);
    await createNamespace(promWorkspaceId, namespace, alarmConfigs);
    log
      .info()
      .str('function', 'managePromNamespaceAlarms')
      .str('namespace', namespace)
      .msg(
        'Created new namespace and added rules. Waiting for namespace to become active.',
      );
    await waitForNamespaceActive(promWorkspaceId, namespace);
    return;
  }

  // Reuse the namespace details fetched above for the rule count
  const nsDetails =
    describedNamespaces.find((ns) => ns.name === namespace)?.details ?? null;
  if (!nsDetails || !isNamespaceDetails(nsDetails)) {
    log
      .warn()
      .str('function', 'managePromNamespaceAlarms')
      .str('namespace', namespace)
      .msg('Invalid or empty namespace details, skipping');
    return;
  }

  // Sanity check: if namespace is empty, delete and recreate it
  if (nsDetails.groups.length === 0) {
    log
      .warn()
      .str('function', 'managePromNamespaceAlarms')
      .str('namespace', namespace)
      .msg(
        'Namespace is empty. Deleting and recreating it with updated rules.',
      );

    const deleteNamespaceCommand = new DeleteRuleGroupsNamespaceCommand({
      workspaceId: promWorkspaceId,
      name: namespace,
    });

    try {
      await client.send(deleteNamespaceCommand);
      log
        .info()
        .str('function', 'managePromNamespaceAlarms')
        .str('namespace', namespace)
        .msg('Deleted empty namespace.');

      await createNamespace(promWorkspaceId, namespace, alarmConfigs);
      log
        .info()
        .str('function', 'managePromNamespaceAlarms')
        .str('namespace', namespace)
        .msg(
          'Recreated namespace with updated rules. Waiting for namespace to become active.',
        );
      await waitForNamespaceActive(promWorkspaceId, namespace);
      return;
    } catch (error) {
      log
        .error()
        .str('function', 'managePromNamespaceAlarms')
        .str('namespace', namespace)
        .err(error)
        .msg('Failed to delete empty namespace.');
      throw new Error(
        `Failed to delete empty namespace: ${error}. Function will be unable to proceed.`,
      );
    }
  }

  // Find the rule group within the namespace or create a new one. A newly
  // created rule group must be pushed into nsDetails.groups, otherwise the
  // rules added to it are silently dropped when nsDetails is dumped to YAML.
  let ruleGroup = nsDetails.groups.find(
    (rg): rg is RuleGroup => rg.name === ruleGroupName,
  );
  if (!ruleGroup) {
    ruleGroup = {name: ruleGroupName, rules: []};
    nsDetails.groups.push(ruleGroup);
  }

  // Iterate over the alarm configurations and update or add rules
  for (const config of alarmConfigs) {
    // Find the index of the existing rule with the same name
    const existingRuleIndex = ruleGroup.rules.findIndex(
      (rule): rule is AMPRule => rule.alert === config.alarmName,
    );

    if (existingRuleIndex !== -1) {
      // If the rule exists, update its expression if it has changed
      const existingRule = ruleGroup.rules[existingRuleIndex];
      if (
        existingRule.expr !== config.alarmQuery ||
        existingRule.for !== config.duration
      ) {
        log
          .info()
          .str('function', 'managePromNamespaceAlarms')
          .str('namespace', namespace)
          .str('ruleGroupName', ruleGroupName)
          .str('alarmName', config.alarmName)
          .msg(
            'AMPRule exists but expression or duration has changed. Updating the rule.',
          );

        // Update existing rule's expression and duration
        ruleGroup.rules[existingRuleIndex] = {
          ...existingRule,
          expr: config.alarmQuery,
          for: config.duration,
        };
      } else {
        log
          .info()
          .str('function', 'managePromNamespaceAlarms')
          .str('namespace', namespace)
          .str('ruleGroupName', ruleGroupName)
          .str('alarmName', config.alarmName)
          .msg('AMPRule exists and is identical. No update needed.');
      }
    } else {
      // If the rule does not exist, add a new rule to the rule group
      log
        .info()
        .str('function', 'managePromNamespaceAlarms')
        .str('namespace', namespace)
        .str('ruleGroupName', ruleGroupName)
        .str('alarmName', config.alarmName)
        .msg('AMPRule does not exist. Adding new rule to the rule group.');
      ruleGroup.rules.push({
        alert: config.alarmName,
        expr: config.alarmQuery,
        for: config.duration,
        labels: {severity: config.severityType},
        annotations: {
          summary: `${config.alarmName} alert triggered`,
          description: 'The alert was triggered based on the specified query',
        },
      });
    }
  }

  // Convert the updated namespace details to YAML and encode it
  const updatedYaml = yaml.dump(nsDetails);
  const updatedData = new TextEncoder().encode(updatedYaml);

  // Create a PutRuleGroupsNamespaceCommand to update the namespace
  const putCommand = new PutRuleGroupsNamespaceCommand({
    workspaceId: promWorkspaceId,
    name: namespace,
    data: updatedData,
  });

  // Send the command to update the namespace
  try {
    await client.send(putCommand);
    log
      .info()
      .str('function', 'managePromNamespaceAlarms')
      .str('namespace', namespace)
      .msg('Updated rule group namespace');
  } catch (error) {
    log
      .error()
      .str('function', 'managePromNamespaceAlarms')
      .str('namespace', namespace)
      .err(error)
      .msg('Failed to update rule group namespace');
    throw new Error(`Failed to update rule group namespace: ${error}`);
  }
}

/**
 * Function to delete Prometheus rules for a service.
 * @param promWorkspaceId - The Prometheus workspace ID.
 * @param service - The service name.
 * @param serviceIdentifiers - The service identifiers.
 */
export async function deletePromRulesForService(
  promWorkspaceId: string,
  service: string,
  serviceIdentifiers: string[],
): Promise<void> {
  const namespace = `AutoAlarm-${service.toUpperCase()}`;
  const ruleGroupName = 'AutoAlarm';

  try {
    // checking if the workspace exists. If not, we can return early.
    // TODO Fix the use of any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workspaceDescription: any =
      await verifyPromWorkspace(promWorkspaceId);
    if (!workspaceDescription) {
      log
        .info()
        .str('function', 'deletePromRulesForService')
        .str('promWorkspaceId', promWorkspaceId)
        .msg('Invalid or empty workspace details. Nothing to delete.');
      return;
    }

    const nsDetails = await describeNamespace(promWorkspaceId, namespace);
    if (!nsDetails || !isNamespaceDetails(nsDetails)) {
      log
        .warn()
        .str('namespace', namespace)
        .msg('Invalid or empty namespace details. Nothing to delete.');
      return;
    }

    const ruleGroup = nsDetails.groups.find(
      (rg): rg is RuleGroup => rg.name === ruleGroupName,
    );

    if (!ruleGroup) {
      log
        .info()
        .str('function', 'deletePromRulesForService')
        .str('ruleGroupName', ruleGroupName)
        .msg('Prometheus AMPRule group not found, nothing to delete');
      return;
    }

    // Filter out rules associated with any of the serviceIdentifiers
    ruleGroup.rules = ruleGroup.rules.filter(
      (rule) => !serviceIdentifiers.some((id) => rule.alert.includes(id)),
    );

    if (ruleGroup.rules.length === 0) {
      // If no rules are left, remove the rule group from the namespace
      nsDetails.groups = nsDetails.groups.filter(
        (rg) => rg.name !== ruleGroupName,
      );
      log
        .info()
        .str('function', 'deletePromRulesForService')
        .str('ruleGroupName', ruleGroupName)
        .msg('No Prometheus rules left, removing the rule group');
    }

    const updatedYaml = yaml.dump(nsDetails);

    if (updatedYaml === 'groups: []\n') {
      // If updated YAML is empty, delete the namespace
      log
        .info()
        .str('function', 'deletePromRulesForService')
        .str('namespace', namespace)
        .str('config YAML', updatedYaml)
        .msg('No rules left in namespace, deleting the namespace');
      const deleteNamespaceCommand = new DeleteRuleGroupsNamespaceCommand({
        workspaceId: promWorkspaceId,
        name: namespace,
      });

      try {
        await client.send(deleteNamespaceCommand);
        log
          .info()
          .str('function', 'deletePromRulesForService')
          .str('namespace', namespace)
          .msg('Namespace deleted as it has no rule groups left.');
        return;
      } catch (error) {
        log
          .error()
          .str('function', 'deletePromRulesForService')
          .str('namespace', namespace)
          .err(error)
          .msg('Failed to delete namespace');
        throw new Error(`Failed to delete namespace: ${error}`);
      }
    } else {
      const updatedData = new TextEncoder().encode(updatedYaml);

      const putCommand = new PutRuleGroupsNamespaceCommand({
        workspaceId: promWorkspaceId,
        name: namespace,
        data: updatedData,
      });

      await client.send(putCommand);
      log
        .info()
        .str('function', 'deletePromRulesForService')
        .str('namespace', namespace)
        .str('service', service)
        .str('serviceIdentifiers', JSON.stringify(serviceIdentifiers))
        .str('ruleGroupName', ruleGroupName)
        .msg('Deleted Prometheus rules associated with the service.');
      return;
    }
  } catch (error) {
    log
      .error()
      .str('function', 'deletePromRulesForService')
      .obj('error', error as object)
      .msg('Error deleting Prometheus rules.');
    throw new Error(`Failed to delete Prometheus rules: ${error}`);
  }
}
