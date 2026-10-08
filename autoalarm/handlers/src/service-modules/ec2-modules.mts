import {
  DescribeInstancesCommand,
  DescribeTagsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {ComparisonOperator} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchClient,
  ListMetricsCommand,
  PutMetricAlarmCommand,
} from '@aws-sdk/client-cloudwatch';
import * as logging from '@nr1e/logging';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {
  deleteAlarm,
  doesAlarmExist,
  fetchResourceTags,
  getCWAlarmsForInstance,
  handleAnomalyAlarms,
  handleStaticAlarms,
  massDeleteAlarms,
  batchPromRulesDeletion,
  batchUpdatePromRules,
  queryPrometheusForService,
  parseMetricAlarmOptions,
} from '../alarm-configs/utils/index.mjs';
import {EC2_CONFIGS} from '../alarm-configs/_index.mjs';
import {
  MetricAlarmConfig,
  MetricAlarmOptions,
  PathMetrics,
  Tag,
  EC2AlarmManagerArray,
  ValidInstanceState,
} from '../types/index.mjs';

const log: logging.Logger = logging.getLogger('ec2-modules');
export const prometheusWorkspaceId: string =
  process.env.PROMETHEUS_WORKSPACE_ID || '';
const region = process.env.AWS_REGION;
const retryStrategy = new ConfiguredRetryStrategy(20);
const ec2Client: EC2Client = new EC2Client({
  region: region,
  retryStrategy: retryStrategy,
});
const cloudWatchClient: CloudWatchClient = new CloudWatchClient({
  region: region,
  retryStrategy: retryStrategy,
});

// This function is used to confirm that memory metrics are being reported for an instance
async function getMemoryMetricsFromCloudWatch(
  instanceId: string,
  metricName: string,
): Promise<boolean> {
  const params = {
    Namespace: 'CWAgent',
    MetricName: metricName,
    Dimensions: [
      {
        Name: 'InstanceId',
        Value: instanceId,
      },
    ],
  };

  const command = new ListMetricsCommand(params);
  const response = await cloudWatchClient.send(command);
  const metrics = response.Metrics || [];
  log
    .info()
    .str('function', 'getMemoryMetricsFromCloudWatch')
    .str('instanceId', instanceId)
    .str('metricName', metricName)
    .str('metrics', JSON.stringify(metrics))
    .msg('Fetched CloudWatch metrics');

  if (metrics.length >= 1) {
    log
      .info()
      .str('function', 'getMemoryMetricsFromCloudWatch')
      .str('instanceId', instanceId)
      .str('metricName', metricName)
      .msg('Memory metrics found for instance');
    return true;
  } else {
    return false;
  }
}

// This function is used to get the storage paths and their associated dimensions from CloudWatch for our ManageStorageAlarmForInstance function
async function getStoragePathsFromCloudWatch(
  instanceId: string,
  metricName: string,
): Promise<PathMetrics> {
  // First, determine if the instance is running Windows
  const instanceDetailProps = await getInstanceDetails(instanceId);
  const isWindows = instanceDetailProps.platform
    ? instanceDetailProps.platform.toLowerCase().includes('windows')
    : false;

  // Set required dimensions based on the operating system
  const requiredDimensions = isWindows
    ? [
        'InstanceId',
        'ImageId',
        'InstanceType',
        'instance', // Adjusted for Windows
        'objectname', // Adjusted for Windows
      ]
    : ['InstanceId', 'ImageId', 'InstanceType', 'device', 'path', 'fstype'];

  const params = {
    Namespace: 'CWAgent',
    MetricName: metricName,
    Dimensions: [
      {
        Name: 'InstanceId',
        Value: instanceId,
      },
    ],
  };

  const command = new ListMetricsCommand(params);
  const response = await cloudWatchClient.send(command);
  const metrics = response.Metrics || [];
  log
    .info()
    .str('function', 'getStoragePathsFromCloudWatch')
    .str('instanceId', instanceId)
    .str('metricName', metricName)
    .str('metrics', JSON.stringify(metrics))
    .msg('Fetched CloudWatch metrics');

  // Initialize a result object to store dimensions grouped by path
  const paths: PathMetrics = {};

  for (const metric of metrics) {
    // Initialize a map to hold dimension values for this metric
    const dimensionMap: Record<string, string> = {};
    requiredDimensions.forEach((dim) => {
      dimensionMap[dim] = ''; // Initialize all required dimensions with empty strings
    });
    dimensionMap['InstanceId'] = instanceId; // Always set InstanceId

    // Populate the dimension map with metric's values
    metric.Dimensions?.forEach((dim) => {
      if (dim.Name && dim.Value && requiredDimensions.includes(dim.Name)) {
        dimensionMap[dim.Name] = dim.Value;
      }
    });

    // Extract the path dimension based on the OS and ensure it's defined
    const pathKey = isWindows ? 'instance' : 'path';
    const path = dimensionMap[pathKey];
    if (
      path &&
      !path.startsWith('/snap') &&
      !path.startsWith('/run') &&
      !path.startsWith('/dev/shm') &&
      !path.startsWith('/boot')
    ) {
      // Build an array of dimensions
      // Adds this array to the path object using the path as the key
      paths[path] = requiredDimensions.map((name) => ({
        Name: name,
        Value: dimensionMap[name],
      }));
    }
  }

  return paths;
}

//this function is used to get the instance OS platform type for CW metrics specific to mem and storage and private IP
// address for promQL queries
async function getInstanceDetails(
  instanceId: string,
): Promise<{platform: string | null; privateIP: string | null}> {
  try {
    const describeInstancesCommand = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });
    const describeInstancesResponse = await ec2Client.send(
      describeInstancesCommand,
    );

    if (
      describeInstancesResponse.Reservations &&
      describeInstancesResponse.Reservations.length > 0 &&
      describeInstancesResponse.Reservations[0].Instances &&
      describeInstancesResponse.Reservations[0].Instances.length > 0
    ) {
      const instance = describeInstancesResponse.Reservations[0].Instances[0];
      const platform = instance.PlatformDetails ?? null;
      const privateIP = instance.PrivateIpAddress ?? '';

      if (!platform) {
        log
          .info()
          .str('function', 'getInstanceDetails')
          .err('No platform details found')
          .str('instanceId', instanceId)
          .msg('No platform details found');
        throw new Error('No platform details found');
      }
      log
        .info()
        .str('function', 'getInstanceDetails')
        .str('instanceId', instanceId)
        .str('platform', platform)
        .str('privateIP', privateIP)
        .msg('Fetched instance details');
      return {platform, privateIP};
    } else {
      log
        .info()
        .str('function', 'getInstanceDetails')
        .str('instanceId', instanceId)
        .msg('No reservations found or no instances in reservation');
      return {platform: null, privateIP: ''};
    }
  } catch (error) {
    log
      .error()
      .str('function', 'getInstanceDetails')
      .err(error)
      .str('instanceId', instanceId)
      .msg('Failed to fetch instance details');
    return {platform: null, privateIP: ''};
  }
}

export async function createStatusAlarmForInstance(
  instanceId: string,
): Promise<void> {
  const alarmName = `AutoAlarm-EC2-${instanceId}-StatusCheckFailed`;
  let alarmExists: boolean;
  try {
    alarmExists = await doesAlarmExist(alarmName);
  } catch (error) {
    log
      .error()
      .str('function', 'createStatusAlarmForInstance')
      .err(error)
      .str('alarmName', alarmName)
      .str('instanceId', instanceId)
      .msg('Error checking for alarm');
    throw error;
  }
  if (!alarmExists) {
    await cloudWatchClient.send(
      new PutMetricAlarmCommand({
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        EvaluationPeriods: 1,
        MetricName: 'StatusCheckFailed',
        Namespace: 'AWS/EC2',
        Period: 60,
        Statistic: 'Average',
        Threshold: 0,
        ActionsEnabled: false,
        Dimensions: [{Name: 'InstanceId', Value: instanceId}],
        Tags: [{Key: 'severity', Value: 'critical'}],
        TreatMissingData: 'breaching',
      }),
    );
    log
      .info()
      .str('function', 'createStatusAlarmForInstance')
      .str('alarmName', alarmName)
      .str('instanceId', instanceId)
      .msg('Created alarm');
  } else {
    log
      .info()
      .str('function', 'createStatusAlarmForInstance')
      .str('alarmName', alarmName)
      .str('instanceId', instanceId)
      .msg('Alarm already exists for instance');
  }
}

async function checkAndManageStatusAlarm(instanceId: string, tags: Tag) {
  if (tags['autoalarm:enabled'] === 'false') {
    await deleteAlarm(`AutoAlarm-EC2-${instanceId}-StatusCheckFailed`);
    log.info().msg('Status check alarm creation skipped due to tag settings.');
  } else if (tags['autoalarm:enabled'] === 'true') {
    // Create status check alarm if not disabled
    await createStatusAlarmForInstance(instanceId);
  } else if (tags['autoalarm:enabled'] in tags) {
    log
      .warn()
      .str('function', 'checkAndManageStatusAlarm')
      .msg(
        'autoalarm:enabled tag exists but has unexpected value. checking for alarm and creating if it does not exist',
      );
    await createStatusAlarmForInstance(instanceId);
  }
}

const metricConfigs = EC2_CONFIGS;

export async function fetchInstanceTags(
  instanceId: string,
): Promise<{[key: string]: string}> {
  return fetchResourceTags('EC2', instanceId, async () => {
    const response = await ec2Client.send(
      new DescribeTagsCommand({
        Filters: [{Name: 'resource-id', Values: [instanceId]}],
      }),
    );

    const tags: {[key: string]: string} = {};
    response.Tags?.forEach((tag) => {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    });

    return tags;
  });
}

async function handleAlarmCreation(
  config: MetricAlarmConfig,
  instanceId: string,
  isWindows: boolean,
  tagValue: string,
  updatedDefaults: MetricAlarmOptions,
  alarmType: 'anomaly' | 'static',
  alarmsToKeep: Set<string>,
) {
  const alarmMessage =
    alarmType === 'anomaly' ? 'anomaly detection alarm' : 'static alarm';
  const alarmFunction =
    alarmType === 'anomaly' ? handleAnomalyAlarms : handleStaticAlarms;

  switch (true) {
    /**
     * memory case handles both windows and linux instances.
     */
    case config.tagKey.includes('memory'): {
      // Resolve the correct metric name on a local copy of the config before
      // making the CloudWatch call. Never mutate the shared EC2_CONFIGS
      // objects: they are module-level and mutations leak across warm Lambda
      // invocations and into the Prometheus path.
      const resolvedConfig: MetricAlarmConfig = {
        ...config,
        metricName: isWindows
          ? 'Memory % Committed Bytes In Use'
          : 'mem_used_percent',
      };

      const memoryMetricsExist = await getMemoryMetricsFromCloudWatch(
        instanceId,
        resolvedConfig.metricName,
      );

      if (memoryMetricsExist) {
        log
          .info()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .str('EC2 instance ID', instanceId)
          .msg(
            `Found memory metrics. Proceeding with memory ${alarmMessage} creation`,
          );

        const alarms = await alarmFunction(
          resolvedConfig,
          'EC2',
          instanceId,
          [{Name: 'InstanceId', Value: instanceId}],
          updatedDefaults,
        );
        alarms.forEach((alarmName) => alarmsToKeep.add(alarmName));
      } else {
        log
          .warn()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .str('EC2 instance ID', instanceId)
          .msg(
            `No memory metrics found. Skipping memory ${alarmMessage} creation`,
          );
      }
      break;
    }

    /**
     * storage case handles both windows and linux instances.
     */
    case config.tagKey.includes('storage'): {
      /**
       * Resolve the correct metric name on a local copy of the config before
       * making the CloudWatch call (never mutate the shared EC2_CONFIGS
       * objects). For Windows, the metric measures free space instead of used
       * space, so apply the Windows-specific thresholds and comparison
       * operator to the DEFAULTS and re-parse the tag value, so any user tag
       * overrides still win over the Windows defaults.
       */
      const resolvedConfig: MetricAlarmConfig = {
        ...config,
        metricName: isWindows
          ? 'LogicalDisk % Free Space'
          : 'disk_used_percent',
      };

      let resolvedDefaults = updatedDefaults;
      if (isWindows) {
        const windowsDefaults: MetricAlarmOptions = {
          ...config.defaults,
          warningThreshold: 15,
          criticalThreshold: 10,
          comparisonOperator: ComparisonOperator.LessThanThreshold,
        };
        resolvedDefaults = parseMetricAlarmOptions(tagValue, windowsDefaults);
      }

      const storagePaths = await getStoragePathsFromCloudWatch(
        instanceId,
        resolvedConfig.metricName,
      );

      if (Object.keys(storagePaths).length > 0) {
        const paths = Object.keys(storagePaths);
        for (const path of paths) {
          const dimensions_props = storagePaths[path].map((dimension) => ({
            Name: dimension.Name,
            Value: dimension.Value,
          }));
          log
            .info()
            .str('function', 'handleAlarmCreation')
            .str('EC2 instance ID', instanceId)
            .obj('dimensions', dimensions_props)
            .msg(
              `Found storage metrics. Proceeding with storage ${alarmMessage} creation`,
            );

          const alarms = await alarmFunction(
            resolvedConfig,
            'EC2',
            instanceId,
            [...dimensions_props],
            resolvedDefaults,
            path,
          );
          alarms.forEach((alarmName) => alarmsToKeep.add(alarmName));
        }
      } else {
        log
          .info()
          .str('function', 'handleAlarmCreation')
          .str('EC2 instance ID', instanceId)
          .msg(
            `No storage metrics found. Skipping storage ${alarmMessage} creation`,
          );
      }
      break;
    }
    default: {
      log
        .info()
        .str('function', 'handleAlarmCreation')
        .str('EC2 instance ID', instanceId)
        .msg(
          `Metrics for ${alarmType} alarm are OS agnostic. Proceeding with ${alarmMessage} creation`,
        );

      const alarms = await alarmFunction(
        config,
        'EC2',
        instanceId,
        [{Name: 'InstanceId', Value: instanceId}],
        updatedDefaults,
      );
      alarms.forEach((alarmName) => alarmsToKeep.add(alarmName));
      break;
    }
  }
}

// Helper function to handle CloudWatch alarm logic
async function handleCloudWatchAlarms(
  instanceID: string,
  tags: Tag,
  isWindows: boolean,
) {
  const alarmsToKeep = new Set<string>();

  await checkAndManageStatusAlarm(instanceID, tags);
  alarmsToKeep.add(`AutoAlarm-EC2-${instanceID}-StatusCheckFailed`);

  for (const config of metricConfigs) {
    log
      .info()
      .str('function', 'manageActiveEC2InstanceAlarms')
      .obj('config', config)
      .str('EC2 instance ID', instanceID)
      .msg('Processing metric configuration');

    const tagValue = tags[`autoalarm:${config.tagKey}`];
    const updatedDefaults = parseMetricAlarmOptions(
      tagValue || '',
      config.defaults,
    );

    if (config.defaultCreate || tagValue !== undefined) {
      await handleAlarmCreation(
        config,
        instanceID,
        isWindows,
        tagValue || '',
        updatedDefaults,
        config.tagKey.includes('anomaly') ? 'anomaly' : 'static',
        alarmsToKeep,
      );
    }
  }

  // EC2 intentionally keeps prefix-based reconciliation instead of the
  // exact expected-name filtering used by other service modules: instance ids
  // (i-xxxxxxxx) are fixed-format and cannot prefix-collide with another
  // instance id, and EC2 storage alarms embed dynamic storage paths and
  // platform-resolved metric names that cannot be precomputed from the
  // configs alone.
  const existingAlarms = await getCWAlarmsForInstance('EC2', instanceID);
  const alarmsToDelete = existingAlarms.filter(
    (alarm) => !alarmsToKeep.has(alarm),
  );

  log
    .info()
    .obj('alarms to delete', alarmsToDelete)
    .msg('Deleting unnecessary alarms');

  await massDeleteAlarms(alarmsToDelete);
}

// Helper function to get disabled alarms
async function getDisabledAlarms(
  deleteInstanceAlarmsArray: EC2AlarmManagerArray,
): Promise<string[]> {
  const disabledAlarmsPromises = deleteInstanceAlarmsArray.flatMap(
    ({instanceID}) => getCWAlarmsForInstance('EC2', instanceID),
  );
  return (await Promise.all(disabledAlarmsPromises)).flat();
}

//TODO: For testing we need to do both alarms. After testing, we need to remove cw alarms if we use prometheus.
export async function manageActiveEC2InstanceAlarms(
  activeInstancesInfoArray: EC2AlarmManagerArray,
) {
  try {
    const prometheusArray: EC2AlarmManagerArray = [];
    const deleteInstanceAlarmsArray: EC2AlarmManagerArray = [];
    const deletePrometheusAlarmsArray: EC2AlarmManagerArray = [];

    const instanceIDsReportingToPrometheus: string[] = prometheusWorkspaceId
      ? await queryPrometheusForService('ec2', prometheusWorkspaceId, region!)
      : [];

    for (const {instanceID, tags, state} of activeInstancesInfoArray) {
      try {
        log
          .info()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .str('EC2 instance ID', instanceID)
          .msg('Starting alarm management process');

        const ec2Metadata = await getInstanceDetails(instanceID);

        const isWindows = ec2Metadata.platform?.includes('Windows') || false;
        const isAlarmEnabled = tags['autoalarm:enabled'] === 'true';

        /*
         * queryPrometheusForService returns a mix of instance IDs and bare
         * private IPs (the 'instance' label is often ip:port, which is
         * stripped to the bare IP), so membership must be checked against
         * BOTH the instance ID and the instance's private IP.
         */
        const reportsToPrometheus =
          instanceIDsReportingToPrometheus.includes(instanceID) ||
          (!!ec2Metadata.privateIP &&
            instanceIDsReportingToPrometheus.includes(ec2Metadata.privateIP));

        if (!isAlarmEnabled) {
          log
            .info()
            .str('function', 'manageActiveEC2InstanceAlarms')
            .str('EC2 instance ID', instanceID)
            .msg('Alarm creation disabled by tag settings');

          deleteInstanceAlarmsArray.push({
            instanceID,
            tags,
            state,
            ec2Metadata,
          });
          continue; // Skip further processing for this instance
        }

        // Check if instance reports to Prometheus and process Prometheus alarms
        if (
          prometheusWorkspaceId &&
          (tags['autoalarm:target'] === 'prometheus' ||
            (!tags['autoalarm:target'] && reportsToPrometheus))
        ) {
          log
            .info()
            .str('function', 'manageActiveEC2InstanceAlarms')
            .str('EC2 instance ID', instanceID)
            .str('privateIP', ec2Metadata.privateIP as string)
            .msg(
              'Instance reports to Prometheus. Processing Prometheus alarms',
            );

          try {
            const CWAlarmsToDelete = await getCWAlarmsForInstance(
              'EC2',
              instanceID,
            );
            if (CWAlarmsToDelete.length > 0) {
              log
                .info()
                .str('function', 'manageActiveEC2InstanceAlarms')
                .str('EC2 instance ID', instanceID)
                .obj('CWAlarmsToDelete', CWAlarmsToDelete)
                .msg('Deleting CloudWatch alarms for instances with auto');

              await massDeleteAlarms(CWAlarmsToDelete);
            }
          } catch (error) {
            log
              .error()
              .str('function', 'manageActiveEC2InstanceAlarms')
              .str('EC2 instance ID', instanceID)
              .err(error)
              .msg('Failed to delete CloudWatch alarms for instance');
            throw new Error(
              `Error deleting CW Alarms for instance ${instanceID}: ${error}`,
            );
          }

          prometheusArray.push({instanceID, tags, state, ec2Metadata});
        } else if (
          tags['autoalarm:target'] === 'cloudwatch' ||
          (!tags['autoalarm:target'] && !reportsToPrometheus) ||
          (tags['autoalarm:target'] === 'prometheus' && !reportsToPrometheus)
        ) {
          log
            .info()
            .str('function', 'manageActiveEC2InstanceAlarms')
            .str('EC2 instance ID', instanceID)
            .str('tags', JSON.stringify(tags))
            .msg(
              'autoalarm target set to cloudwatch. Creating cloudwatch alarms in place of prometheus alarms',
            );

          if (reportsToPrometheus) {
            deletePrometheusAlarmsArray.push({
              instanceID,
              tags,
              state,
              ec2Metadata,
            });
          }

          try {
            await handleCloudWatchAlarms(instanceID, tags, isWindows);
          } catch (error) {
            log
              .error()
              .str('function', 'manageActiveEC2InstanceAlarms')
              .str('EC2 instance ID', instanceID)
              .err(error)
              .msg('Error handling CloudWatch alarms for instance');
            throw new Error(
              `Error handling CW Alarms for instance ${instanceID}: ${error}`,
            );
          }
        }
      } catch (instanceError) {
        log
          .error()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .str('EC2 instance ID', instanceID)
          .err(instanceError)
          .msg('Error processing EC2 instance');
        throw new Error(
          `Error processing instance ${instanceID}: ${instanceError}`,
        );
      }
    }

    // Process Prometheus alarms
    if (prometheusArray.length > 0) {
      try {
        log
          .info()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .obj(
            'instances reporting to Prometheus',
            instanceIDsReportingToPrometheus,
          )
          .msg('Processing Prometheus alarms');

        await batchUpdatePromRules(
          prometheusWorkspaceId,
          'ec2',
          prometheusArray,
        );
      } catch (error) {
        log
          .error()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .err(error)
          .msg('Failed to batch update Prometheus rules');
        throw new Error(`Error batch updating Prometheus rules: ${error}`);
      }
    }

    // Delete prometheus alarms if autoalarm:target is set to cloudwatch
    if (deletePrometheusAlarmsArray.length > 0) {
      try {
        log
          .info()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .str('prometheusWorkspaceId', prometheusWorkspaceId)
          .obj('deletePrometheusAlarmsArray', deletePrometheusAlarmsArray)
          .msg(
            'Deleting Prometheus alarms for instances with autoalarm:target set to cloudwatch',
          );

        await batchPromRulesDeletion(
          prometheusWorkspaceId,
          deletePrometheusAlarmsArray,
          'ec2',
        );
      } catch (error) {
        log
          .error()
          .str('function', 'manageActiveEC2InstanceAlarms')
          .err(error)
          .msg('Failed to delete Prometheus alarms');
        throw new Error(`Error deleting Prometheus alarms: ${error}`);
      }
    }

    // Delete CloudWatch Alarms for instances with autoalarm:enabled = false
    try {
      log
        .info()
        .msg(
          'Deleting CW alarms for instances with autoalarm:enabled set to false',
        );

      const disabledAlarms = await getDisabledAlarms(deleteInstanceAlarmsArray);
      await massDeleteAlarms(disabledAlarms);
    } catch (error) {
      log
        .error()
        .str('function', 'manageActiveEC2InstanceAlarms')
        .err(error)
        .msg('Failed to delete CW alarms for disabled instances');
      throw new Error(
        `Error deleting CW alarms for disabled instances: ${error}`,
      );
    }

    // Delete Prometheus alarms for instances with autoalarm:enabled = false
    try {
      log
        .info()
        .msg(
          'Deleting Prometheus alarms for instances with autoalarm:enabled set to false if they exist.',
        );

      if (prometheusWorkspaceId && deleteInstanceAlarmsArray.length > 0) {
        await batchPromRulesDeletion(
          prometheusWorkspaceId,
          deleteInstanceAlarmsArray,
          'ec2',
        );
      }
    } catch (error) {
      log
        .error()
        .str('function', 'manageActiveEC2InstanceAlarms')
        .err(error)
        .msg('Failed to delete Prometheus alarms for disabled instances');
      throw new Error(
        `Error deleting Prometheus alarms for disabled instances: ${error}`,
      );
    }
  } catch (error) {
    log
      .error()
      .str('function', 'manageActiveEC2InstanceAlarms')
      .err(error)
      .msg('Unhandled error in manageActiveEC2InstanceAlarms function');
    throw error; // Re-throw the error for higher-level handling
  }
}

// TODO: add prom logic for this function as well.
export async function manageInactiveInstanceAlarms(
  inactiveInstancesInfoArray: EC2AlarmManagerArray,
) {
  const instanceIPsReportingToPrometheus: string[] = prometheusWorkspaceId
    ? await queryPrometheusForService('ec2', prometheusWorkspaceId, region!)
    : [];

  const CWAlarmsToDelete: string[] = [];
  const prometheusAlarmsToDelete: EC2AlarmManagerArray = [];
  for (const instanceInfo of inactiveInstancesInfoArray) {
    const ec2MetaData = await getInstanceDetails(instanceInfo.instanceID);

    /*
     * queryPrometheusForService returns a mix of instance IDs and bare private
     * IPs (the 'instance' label is often ip:port, which is stripped to the
     * bare IP), so membership must be checked against BOTH the instance ID and
     * the instance's private IP.
     */
    const reportsToPrometheus =
      instanceIPsReportingToPrometheus.includes(instanceInfo.instanceID) ||
      (!!ec2MetaData.privateIP &&
        instanceIPsReportingToPrometheus.includes(ec2MetaData.privateIP));

    // Check if instance reports to Prometheus and process Prometheus alarm deletion
    if (reportsToPrometheus) {
      prometheusAlarmsToDelete.push({
        instanceID: instanceInfo.instanceID,
        tags: instanceInfo.tags,
        state: instanceInfo.state,
        ec2Metadata: ec2MetaData,
      });
    }

    const existingAlarms: string[] = await getCWAlarmsForInstance(
      'EC2',
      instanceInfo.instanceID,
    );
    CWAlarmsToDelete.push(...existingAlarms);
  }
  try {
    // Delete all cw alarms for instance. massDeleteAlarms chunks the names to
    // stay within the DeleteAlarms API limit of 100 names per call.
    await massDeleteAlarms(CWAlarmsToDelete);

    // Delete all prometheus alarms for instance if they exist.
    if (prometheusAlarmsToDelete.length > 0) {
      log
        .info()
        .str('function', 'manageInactiveInstanceAlarms')
        .str('prometheusWorkspaceId', prometheusWorkspaceId)
        .obj('prometheusAlarmsToDelete', prometheusAlarmsToDelete)
        .msg(
          'Deleting Prometheus alarms for inactive instances that are reporting to prometheus if those alarm rules exist.',
        );
      await batchPromRulesDeletion(
        prometheusWorkspaceId,
        prometheusAlarmsToDelete,
        'ec2',
      );
    }
  } catch (e) {
    log
      .error()
      .str('function', 'manageInactiveInstanceAlarms')
      .err(e)
      .msg(`Error deleting alarms: ${e}`);
    throw new Error(`Error deleting alarms: ${e}`);
  }
}

export async function getEC2IdAndState(
  // TODO Fix the use of any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
): Promise<{instanceId: string; state: ValidInstanceState}> {
  const instanceId = event.resources[0].split('/').pop();
  log.info().str('resourceId', instanceId).msg('Processing tag event');

  const describeInstancesResponse = await ec2Client.send(
    new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    }),
  );
  const instance = describeInstancesResponse.Reservations?.[0]?.Instances?.[0];
  const state = instance?.State?.Name as ValidInstanceState;
  return {instanceId: instanceId, state: state};
}

export const liveStates: Set<ValidInstanceState> = new Set([
  ValidInstanceState.Running,
]);

export const deadStates: Set<ValidInstanceState> = new Set([
  ValidInstanceState.Terminated,
]);
