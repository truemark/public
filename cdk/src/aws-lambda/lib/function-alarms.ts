import {Duration} from 'aws-cdk-lib';
import {
  DurationThreshold,
  ErrorCountThreshold,
  ErrorRateThreshold,
  HighTpsThreshold,
  LatencyThreshold,
  LowTpsThreshold,
  MaxAgeThreshold,
  RunningTaskCountThreshold,
  UsageThreshold,
} from 'cdk-monitoring-constructs';
import {
  AlarmCategory,
  AlarmsBase,
  AlarmsCategoryOptions,
  AlarmsOptions,
} from '../../aws-monitoring/index';
import {IFunction} from 'aws-cdk-lib/aws-lambda';
import {ILogGroup} from 'aws-cdk-lib/aws-logs';
import {Construct} from 'constructs';
import {LogMetricAlarm} from '../../aws-cloudwatch/index';
import {AlarmBase} from 'aws-cdk-lib/aws-cloudwatch';

/**
 * Category options for CloudWatch alarms for Lambda Functions.
 */
export interface FunctionAlarmsCategoryOptions extends AlarmsCategoryOptions {
  /**
   * Maximum 50th percentile latency
   */
  readonly p50Latency?: Duration;

  /**
   * Maximum 90th percentile latency
   */
  readonly p90Latency?: Duration;

  /**
   * Maximum 99th percentile latency
   */
  readonly p99Latency?: Duration;

  /**
   * Maximum number of faults
   *
   * @default 0
   */
  readonly maxFaults?: number;

  /**
   * Average number of faults
   */
  readonly avgFaults?: number;

  /**
   * Minimum transactions
   */
  readonly minTps?: number;

  /**
   * Maximum transactions
   */
  readonly maxTps?: number;

  /**
   * Maximum number of throttles
   *
   * @default 0
   */
  readonly maxThrottles?: number;

  /**
   * Average number of throttles
   */
  readonly avgThrottles?: number;

  /**
   * Maximum concurrent executions
   */
  readonly maxConcurrentExecutions?: number;

  /**
   * Amount of time data waits before being processed by the function.
   * See https://aws.amazon.com/premiumsupport/knowledge-center/lambda-iterator-age/
   */
  readonly maxIteratorAge?: number;

  /**
   * Maximum amount of CPU time
   */
  readonly maxCpuTime?: Duration;

  /**
   * 90th percentile CPU time
   */
  readonly p90CpuTime?: Duration;

  /**
   * Average CPU time
   */
  readonly avgCpuTime?: Duration;

  /**
   * Maximum amount of memory
   */
  readonly maxMemory?: number;

  /**
   * 90th percentile memory
   */
  readonly p90Memory?: number;

  /**
   * Average memory
   */
  readonly avgMemory?: number;

  /**
   * Log pattern to match for metrics.
   *
   * @default '\\\[ERROR\\\]'
   */
  readonly metricLogPattern?: string;

  /**
   * Maximum number of log events matching the metricLogPattern.
   *
   * @default 0 for Critical Alarm
   */
  readonly maxLogCount?: number;

  /**
   * Number of evaluation periods over which data is compared for log events.
   *
   * @default 2
   */
  readonly logEvaluationPeriods?: number;

  /**
   * Number of data points that must be breaching to trigger the alarm for log events.
   *
   * @default 1
   */
  readonly logDataPointsToAlarm?: number;

  /**
   * Log pattern to match for the dashboard
   *
   * @default '"[ERROR]"'
   */
  readonly dashboardLogPattern?: string;
}

/**
 * Options for CloudWatch alarms for Lambda Functions
 */
export interface FunctionAlarmsOptions extends AlarmsOptions<FunctionAlarmsCategoryOptions> {
  /**
   * Flag to create alarms.
   *
   * @default true
   */
  readonly createAlarms?: boolean;

  /**
   * Name to use for alarm, default is construct ID.
   */
  readonly alarmFriendlyName?: string;

  /**
   * Generate dashboard charts for Lambda insights metrics.
   *
   * @default true
   */
  readonly lambdaInsightsEnabled?: boolean;
}

/**
 * Properties for FunctionAlarms
 */
export interface FunctionAlarmsProps extends FunctionAlarmsOptions {
  /**
   * The function to observe.
   */
  readonly function: IFunction;

  /**
   * The log group attached to the function to be observed.
   */
  readonly logGroup: ILogGroup;
}

/**
 * Creates CloudWatch alarms for a Lambda Function.
 */
export class FunctionAlarms extends AlarmsBase<
  FunctionAlarmsCategoryOptions,
  FunctionAlarmsProps
> {
  /**
   * Default pattern used for the critical log metric.
   */
  static readonly DEFAULT_CRITICAL_LOG_METRIC_PATTERN = 'ERROR';
  static readonly BRACKET_ERROR_LOG_METRIC_PATTERN = '"[ERROR]"';

  /**
   * Default pattern used for the warning log metric.
   */
  static readonly DEFAULT_WARNING_LOG_METRIC_PATTERN = 'WARNING';
  static readonly BRACKET_WARNING_LOG_METRIC_PATTERN = '"[WARNING]"';

  /**
   * Default pattern used to show logs on the CloudWatch dashboard.
   */
  static readonly DEFAULT_LOG_INSIGHTS_PATTERN = 'ERROR|WARNING';
  static readonly BRACKET_LOG_INSIGHTS_PATTERN = '\\[ERROR\\]|\\[WARNING\\]';

  private addFunctionMonitoring() {
    if (this.monitoringFacade === undefined) {
      throw new Error('monitoringFacade is undefined');
    }
    this.monitoringFacade.monitorLambdaFunction({
      alarmFriendlyName: this.props.alarmNamePrefix,
      lambdaFunction: this.props.function,
      addToAlarmDashboard: this.props.addToAlarmDashboard ?? true,
      addToDetailDashboard: this.props.addToDetailDashboard ?? true,
      addToSummaryDashboard: this.props.addToSummaryDashboard ?? true,
      addLatencyP50Alarm: this.toRecord<LatencyThreshold>(
        'p50Latency',
        'maxLatency',
      ),
      addLatencyP90Alarm: this.toRecord<LatencyThreshold>(
        'p90Latency',
        'maxLatency',
      ),
      addLatencyP99Alarm: this.toRecord<LatencyThreshold>(
        'p99Latency',
        'maxLatency',
      ),
      addFaultCountAlarm: this.toRecord<ErrorCountThreshold>(
        'maxFaults',
        'maxErrorCount',
        0,
      ),
      addFaultRateAlarm: this.toRecord<ErrorRateThreshold>(
        'avgFaults',
        'maxErrorRate',
      ),
      addLowTpsAlarm: this.toRecord<LowTpsThreshold>('minTps', 'minTps'),
      addHighTpsAlarm: this.toRecord<HighTpsThreshold>('maxTps', 'maxTps'),
      addThrottlesCountAlarm: this.toRecord<ErrorCountThreshold>(
        'maxThrottles',
        'maxErrorCount',
        0,
      ),
      addThrottlesRateAlarm: this.toRecord<ErrorRateThreshold>(
        'avgThrottles',
        'maxErrorRate',
      ),
      addConcurrentExecutionsCountAlarm:
        this.toRecord<RunningTaskCountThreshold>(
          'maxConcurrentExecutions',
          'maxRunningTasks',
        ),
      addMaxIteratorAgeAlarm: this.toRecord<MaxAgeThreshold>(
        'maxIteratorAge',
        'maxAgeInMillis',
      ),
      addEnhancedMonitoringMaxCpuTotalTimeAlarm:
        this.toRecord<DurationThreshold>('maxCpuTime', 'maxDuration'),
      addEnhancedMonitoringP90CpuTotalTimeAlarm:
        this.toRecord<DurationThreshold>('p90CpuTime', 'maxDuration'),
      addEnhancedMonitoringAvgCpuTotalTimeAlarm:
        this.toRecord<DurationThreshold>('avgCpuTime', 'maxDuration'),
      addEnhancedMonitoringMaxMemoryUtilizationAlarm:
        this.toRecord<UsageThreshold>('maxMemory', 'maxUsagePercent'),
      addEnhancedMonitoringP90MemoryUtilizationAlarm:
        this.toRecord<UsageThreshold>('p90Memory', 'maxUsagePercent'),
      addEnhancedMonitoringAvgMemoryUtilizationAlarm:
        this.toRecord<UsageThreshold>('avgMemory', 'maxUsagePercent'),
    });
  }

  // TODO We need to figure out a way to extend monitoringFacade to support creating these alarms. Maybe extend MonotoringFacade.monitorLog()

  private criticalLogAlarm: LogMetricAlarm | undefined;
  private warningLogAlarm: LogMetricAlarm | undefined;

  private addLogAlarm(category: AlarmCategory, defaultThreshold?: number) {
    const fprops =
      category === AlarmCategory.Critical
        ? this.props.criticalAlarmOptions
        : this.props.warningAlarmOptions;
    const threshold = fprops?.maxLogCount ?? defaultThreshold;
    const pattern =
      (fprops?.metricLogPattern ?? category === AlarmCategory.Critical)
        ? FunctionAlarms.DEFAULT_CRITICAL_LOG_METRIC_PATTERN
        : FunctionAlarms.DEFAULT_WARNING_LOG_METRIC_PATTERN;
    const evaluationPeriods = fprops?.logEvaluationPeriods ?? 2;
    const datapointsToAlarm = fprops?.logDataPointsToAlarm ?? 1;
    if (threshold !== undefined && threshold > 0) {
      const logAlarm = new LogMetricAlarm(this, category + 'LogCount', {
        logGroup: this.props.logGroup,
        pattern,
        threshold,
        evaluationPeriods,
        datapointsToAlarm,
        metricName: category + 'LogCount',
      });
      if (category === AlarmCategory.Critical) {
        this.criticalLogAlarm = logAlarm;
      } else {
        this.warningLogAlarm = logAlarm;
      }
    }
  }

  private addLogMonitoringToDashboard() {
    let pattern = FunctionAlarms.DEFAULT_LOG_INSIGHTS_PATTERN;
    if (
      this.props.criticalAlarmOptions?.dashboardLogPattern !== undefined ||
      this.props.warningAlarmOptions?.dashboardLogPattern !== undefined
    ) {
      pattern = '';
      if (this.props.criticalAlarmOptions?.dashboardLogPattern !== undefined) {
        pattern = this.props.criticalAlarmOptions.dashboardLogPattern;
      }
      if (this.props.warningAlarmOptions?.dashboardLogPattern !== undefined) {
        pattern =
          pattern +
          (pattern !== '' ? '|' : '') +
          this.props.warningAlarmOptions.dashboardLogPattern;
      }
    }
    if (pattern !== '') {
      if (this.monitoringFacade === undefined) {
        throw new Error('monitoringFacade is undefined');
      }
      this.monitoringFacade.monitorLog({
        alarmFriendlyName: 'Monitor{this.props.logGroup.logGroupName}',
        logGroupName: this.props.logGroup.logGroupName,
        pattern,
      });
    }
  }

  constructor(scope: Construct, id: string, props: FunctionAlarmsProps) {
    super(scope, id, props);
    if (props.createAlarms ?? true) {
      this.addFunctionMonitoring();
      this.addLogMonitoringToDashboard();
      this.addLogAlarm(AlarmCategory.Critical, 1);
      this.addLogAlarm(AlarmCategory.Warning);
    }
  }

  getAlarms(category: AlarmCategory): AlarmBase[] {
    const alarms = super.getAlarms(category);
    const logAlarm =
      category === AlarmCategory.Critical
        ? this.criticalLogAlarm?.alarm
        : this.warningLogAlarm?.alarm;
    if (logAlarm !== undefined) {
      alarms.push(logAlarm);
    }
    return alarms;
  }
}
