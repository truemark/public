import {Construct} from 'constructs';
import {Duration} from 'aws-cdk-lib';
import {ITable} from 'aws-cdk-lib/aws-dynamodb';
import {
  AlarmsBase,
  AlarmsCategoryOptions,
  AlarmsOptions,
} from '../../aws-monitoring/index';
import {
  ConsumedCapacityThreshold,
  ErrorCountThreshold,
  LatencyThreshold,
  ThrottledEventsThreshold,
} from 'cdk-monitoring-constructs/lib/common';

/**
 * Category options for CloudWatch alarms for DynamoDB Tables.
 */
export interface TableAlarmsCategoryOptions extends AlarmsCategoryOptions {
  readonly maxConsumedReadCapacity?: number;
  readonly maxConsumedWriteCapacity?: number;
  readonly maxReadThrottledEventsCount?: number;
  readonly maxWriteThrottledEventsCount?: number;
  readonly maxSystemErrorCount?: number;
  readonly averageSuccessfulGetRecordsLatency?: Duration;
  readonly averageSuccessfulQueryLatency?: Duration;
  readonly averageSuccessfulScanLatency?: Duration;
  readonly averageSuccessfulPutItemLatency?: Duration;
  readonly averageSuccessfulGetItemLatency?: Duration;
  readonly averageSuccessfulUpdateItemLatency?: Duration;
  readonly averageSuccessfulDeleteItemLatency?: Duration;
  readonly averageSuccessfulBatchGetItemLatency?: Duration;
  readonly averageSuccessfulBatchWriteItemLatency?: Duration;
}

/**
 * Options for TableAlarms
 */
export interface TableAlarmsOptions extends AlarmsOptions<TableAlarmsCategoryOptions> {
  /**
   * Flag to create alarms.
   *
   * @default true
   */
  readonly createAlarms?: boolean;
}

/**
 * Properties for TableAlarms
 */
export interface TableAlarmsProps extends TableAlarmsOptions {
  /**
   * The table to create alarms for.
   */
  readonly table: ITable;
}

/**
 * Creates CloudWatch alarms for DynamoDB Tables.
 */
export class TableAlarms extends AlarmsBase<
  TableAlarmsCategoryOptions,
  TableAlarmsProps
> {
  protected readonly createAlarms: boolean;

  constructor(scope: Construct, id: string, props: TableAlarmsProps) {
    super(scope, id, props);
    this.createAlarms = props.createAlarms ?? true;
    if (this.createAlarms) {
      if (this.monitoringFacade === undefined) {
        throw new Error('monitoringFacade is undefined');
      }
      this.monitoringFacade.monitorDynamoTable({
        table: props.table,
        addToSummaryDashboard: props.addToSummaryDashboard ?? true,
        addToDetailDashboard: props.addToDetailDashboard ?? true,
        addToAlarmDashboard: props.addToAlarmDashboard ?? true,
        addConsumedReadCapacityAlarm: this.toRecord<ConsumedCapacityThreshold>(
          'maxConsumedReadCapacity',
          'maxConsumedCapacityUnits',
        ),
        addConsumedWriteCapacityAlarm: this.toRecord<ConsumedCapacityThreshold>(
          'maxConsumedWriteCapacity',
          'maxConsumedCapacityUnits',
        ),
        addReadThrottledEventsCountAlarm:
          this.toRecord<ThrottledEventsThreshold>(
            'maxReadThrottledEventsCount',
            'maxThrottledEventsThreshold',
            0,
          ),
        addWriteThrottledEventsCountAlarm:
          this.toRecord<ThrottledEventsThreshold>(
            'maxWriteThrottledEventsCount',
            'maxThrottledEventsThreshold',
            0,
          ),
        addSystemErrorCountAlarm: this.toRecord<ErrorCountThreshold>(
          'maxSystemErrorCount',
          'maxErrorCount',
          0,
        ),
        addAverageSuccessfulGetRecordsLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulGetRecordsLatency',
            'maxLatency',
          ),
        addAverageSuccessfulQueryLatencyAlarm: this.toRecord<LatencyThreshold>(
          'averageSuccessfulQueryLatency',
          'maxLatency',
        ),
        addAverageSuccessfulScanLatencyAlarm: this.toRecord<LatencyThreshold>(
          'averageSuccessfulScanLatency',
          'maxLatency',
        ),
        addAverageSuccessfulPutItemLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulPutItemLatency',
            'maxLatency',
          ),
        addAverageSuccessfulGetItemLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulGetItemLatency',
            'maxLatency',
          ),
        addAverageSuccessfulUpdateItemLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulUpdateItemLatency',
            'maxLatency',
          ),
        addAverageSuccessfulDeleteItemLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulDeleteItemLatency',
            'maxLatency',
          ),
        addAverageSuccessfulBatchGetItemLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulBatchGetItemLatency',
            'maxLatency',
          ),
        addAverageSuccessfulBatchWriteItemLatencyAlarm:
          this.toRecord<LatencyThreshold>(
            'averageSuccessfulBatchWriteItemLatency',
            'maxLatency',
          ),
      });
    }
  }

  addGlobalSecondaryIndexMonitoring(indexName: string) {
    if (this.createAlarms) {
      if (this.monitoringFacade === undefined) {
        throw new Error('monitoringFacade is undefined');
      }
      this.monitoringFacade.monitorDynamoTableGlobalSecondaryIndex({
        table: this.props.table,
        globalSecondaryIndexName: indexName,
        addToSummaryDashboard: this.props.addToSummaryDashboard,
        addToDetailDashboard: this.props.addToDetailDashboard,
        addToAlarmDashboard: this.props.addToAlarmDashboard,
      });
    }
  }
}
