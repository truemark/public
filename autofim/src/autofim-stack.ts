import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CfnOutput, Duration, RemovalPolicy} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {LambdaDestination} from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Props for {@link AutoFimStack}. Mirrors the parameters of the AWS blog
 * reference solution
 * (https://aws.amazon.com/blogs/security/file-integrity-monitoring-with-aws-systems-manager-and-amazon-security-lake/)
 * and the sample CloudFormation template at
 * https://github.com/aws-samples/sample-inventory-monitor-fim.
 */
/**
 * Allowed values for the Security Hub ASFF `Severity.Label` field.
 *
 * @see https://docs.aws.amazon.com/securityhub/1.0/APIReference/API_Severity.html
 */
export type SecurityHubSeverityLabel =
  | 'INFORMATIONAL'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

const VALID_SEVERITY_LABELS: readonly SecurityHubSeverityLabel[] = [
  'INFORMATIONAL',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
];

export interface AutoFimStackProps extends ExtendedStackProps {
  /** File system path on the EC2 instance to collect inventory for. */
  readonly monitoredPath: string;
  /** Comma-separated regex patterns identifying critical files. */
  readonly criticalFilePatterns: string;
  /**
   * Security Hub ASFF `Severity.Label` to stamp on every finding this
   * stack's Lambda creates. Must be one of Security Hub's five allowed
   * literals; any other string deploys successfully but makes every
   * `BatchImportFindings` call fail at runtime with a schema-validation
   * error, silently dropping every FIM finding into the DLQ.
   *
   * @default 'MEDIUM'
   */
  readonly findingSeverity?: SecurityHubSeverityLabel;
  /** @default 'rate(30 minutes)' */
  readonly inventorySchedule?: string;
  /** @default 'FIM-Enabled' */
  readonly inventoryTagKey?: string;
  /** @default 'true' */
  readonly inventoryTagValue?: string;
}

/**
 * Deploys the AWS "File Integrity Monitoring with AWS Systems Manager and
 * Amazon Security Lake" reference solution as a CDK stack.
 *
 * Data flow:
 *   EC2 (tagged `FIM-Enabled=true`, SSM Agent running)
 *     -> SSM Inventory (`AWS-GatherSoftwareInventory`) collects file
 *        metadata for `monitoredPath`
 *     -> SSM Resource Data Sync writes inventory JSONL snapshots to the
 *        versioned `fim-inventory-<account>-<region>` bucket
 *     -> S3 `ObjectCreated:*` event invokes `fim-change-detector` Lambda
 *     -> Lambda diffs the two most-recent object versions, filters by
 *        the critical-file regex, and calls
 *        `securityhub:BatchImportFindings`
 *     -> Security Hub finding is picked up by the Security Lake "AWS
 *        Security Hub findings" source (enabled by the sibling AutoSoc
 *        stack) and stored as an OCSF 2004 Detection Finding record.
 */
export class AutoFimStack extends ExtendedStack {
  readonly inventoryBucket: s3.Bucket;
  readonly loggingBucket: s3.Bucket;
  readonly changeDetector: lambda.Function;
  readonly deadLetterQueue: sqs.Queue;
  readonly inventoryAssociation: ssm.CfnAssociation;
  readonly resourceDataSync: ssm.CfnResourceDataSync;

  constructor(scope: Construct, id: string, props: AutoFimStackProps) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/autofim',
    );

    const findingSeverity = props.findingSeverity ?? 'MEDIUM';
    // `findingSeverity` is typed as `SecurityHubSeverityLabel` in TS, but
    // callers commonly source it from raw CDK context strings (e.g.
    // `-c fimFindingSeverity=...`), which bypasses the type system.
    // Validate explicitly so an invalid value fails fast at synth time
    // with a clear message, instead of deploying successfully and then
    // making every `BatchImportFindings` call fail at runtime (silently
    // dropping every FIM finding into the DLQ).
    if (!VALID_SEVERITY_LABELS.includes(findingSeverity)) {
      throw new Error(
        `AutoFimStack: findingSeverity must be one of ` +
          `${VALID_SEVERITY_LABELS.join(', ')} (Security Hub ASFF ` +
          `Severity.Label values). Got: "${findingSeverity}".`,
      );
    }
    const inventorySchedule = props.inventorySchedule ?? 'rate(30 minutes)';
    const inventoryTagKey = props.inventoryTagKey ?? 'FIM-Enabled';
    const inventoryTagValue = props.inventoryTagValue ?? 'true';

    // S3 logging bucket: receives server-access logs from the inventory
    // bucket. Versioned, SSE-S3, TLS-only.
    //
    // Object Lock is intentionally **disabled** on this bucket: Amazon S3
    // rejects access-log delivery to any destination bucket that has
    // Object Lock enabled or a default retention period
    // (https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html
    // — "the destination bucket must not have S3 Object Lock enabled").
    // The upstream aws-samples template defines Object Lock on a
    // *different* bucket; this port had conflated the two. Retention on
    // the access logs is instead enforced by a 90-day lifecycle
    // transition to Glacier plus a non-current-version expiration — not
    // write-once-read-many, but sufficient for a logging target.
    this.loggingBucket = new s3.Bucket(this, 'LoggingBucket', {
      bucketName: `fim-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ExpireAccessLogs',
          enabled: true,
          expiration: Duration.days(365),
          noncurrentVersionExpiration: Duration.days(90),
        },
      ],
    });

    // Inventory bucket: SSM Resource Data Sync destination. Versioning is
    // mandatory because the Lambda diffs the current and previous object
    // versions to detect changes.
    this.inventoryBucket = new s3.Bucket(this, 'InventoryBucket', {
      bucketName: `fim-inventory-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsBucket: this.loggingBucket,
      serverAccessLogsPrefix: 'inventory-access-logs/',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // SSM Resource Data Sync requires an explicit bucket policy allowing
    // the SSM service to GetBucketAcl and PutObject (see
    // https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-inventory-datasync.html).
    //
    // Both statements include `aws:SourceAccount` + `aws:SourceArn` guards
    // (confused-deputy protection), matching the upstream aws-samples
    // template and the SSM policy guidance at
    // https://docs.aws.amazon.com/systems-manager/latest/userguide/ssm-cross-service-confused-deputy-prevention.html.
    // The source ARN is the Resource Data Sync resource that this stack
    // creates below (`fim-inventory-sync-<account>-<region>`).
    const resourceDataSyncArn =
      `arn:${this.partition}:ssm:${this.region}:${this.account}` +
      `:resource-data-sync/fim-inventory-sync-${this.account}-${this.region}`;
    this.inventoryBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'SSMBucketPermissionsCheck',
        actions: ['s3:GetBucketAcl'],
        resources: [this.inventoryBucket.bucketArn],
        principals: [new iam.ServicePrincipal('ssm.amazonaws.com')],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': resourceDataSyncArn,
          },
        },
      }),
    );
    this.inventoryBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'SSMBucketDelivery',
        actions: ['s3:PutObject'],
        resources: [`${this.inventoryBucket.bucketArn}/*`],
        principals: [new iam.ServicePrincipal('ssm.amazonaws.com')],
        conditions: {
          StringEquals: {
            's3:x-amz-acl': 'bucket-owner-full-control',
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': resourceDataSyncArn,
          },
        },
      }),
    );

    // DLQ for the change-detector Lambda. 14-day retention per blog.
    // Uses SQS-managed KMS encryption (`alias/aws/sqs`) to match the
    // upstream aws-samples template, so DLQ'd async-invocation payloads
    // are encrypted at rest.
    this.deadLetterQueue = new sqs.Queue(this, 'ChangeDetectorDLQ', {
      queueName: 'fim-change-detector-dlq',
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    // Change-detector Lambda. Python 3.12, reserved concurrency 10, DLQ
    // for async failures. The handler is intentionally dependency-free
    // (no Lambda layer) so this stack synthesises without Docker.
    this.changeDetector = new lambda.Function(this, 'ChangeDetectorFunction', {
      functionName: 'fim-change-detector',
      description:
        'Detects file changes by comparing SSM Inventory versions and' +
        ' creates Security Hub findings',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', 'lambda', 'fim-change-detector'),
      ),
      timeout: Duration.seconds(120),
      memorySize: 256,
      reservedConcurrentExecutions: 10,
      deadLetterQueueEnabled: true,
      deadLetterQueue: this.deadLetterQueue,
      environment: {
        CRITICAL_FILE_PATTERNS: props.criticalFilePatterns,
        SEVERITY_LABEL: findingSeverity,
      },
    });

    this.changeDetector.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['securityhub:BatchImportFindings'],
        resources: [
          `arn:${this.partition}:securityhub:${this.region}:${this.account}` +
            `:product/${this.account}/default`,
        ],
      }),
    );
    this.inventoryBucket.grantRead(this.changeDetector);
    this.changeDetector.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObjectVersion',
          's3:ListBucketVersions',
          's3:DeleteObjectVersion',
        ],
        resources: [
          this.inventoryBucket.bucketArn,
          `${this.inventoryBucket.bucketArn}/*`,
        ],
      }),
    );

    // S3 -> Lambda event notification.
    //
    // Scoped to the `AWS%3AFile/` prefix so only File-inventory snapshots
    // trigger the Lambda. The account-wide SSM Resource Data Sync writes
    // every inventory type (`AWS:InstanceInformation/`, `AWS:Network/`,
    // etc.) to this bucket; without this filter the handler is invoked
    // for non-file payloads, parses them as empty file metadata, and can
    // delete the previous object version.
    //
    // The colon must be URL-encoded as `%3A`: S3 bucket notification
    // filter rules compare the *raw, URL-encoded* object key (the same
    // encoding S3 uses in the `key` field of the event payload itself,
    // which is why the Lambda handler calls `unquote_plus` on it), not
    // the decoded key. CDK forwards the `prefix` string unchanged to
    // `NotificationConfiguration.LambdaFunctionConfigurations[].Filter`,
    // so passing a literal `:` either fails notification configuration
    // or, worse, silently never matches because the actual object keys
    // are the inventory plugin names (e.g. `AWS%3AFile/...`) that SSM
    // Resource Data Sync writes — a literal `:` in the object key is
    // itself URL-encoded by S3 when stored. Matches the upstream
    // aws-samples template's `S3Key.FilterRules[*].Value = AWS%3AFile/`.
    this.inventoryBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new LambdaDestination(this.changeDetector),
      {prefix: 'AWS%3AFile/'},
    );

    // SSM Resource Data Sync: streams inventory snapshots to S3 as JSONL.
    this.resourceDataSync = new ssm.CfnResourceDataSync(
      this,
      'InventoryResourceDataSync',
      {
        syncName: `fim-inventory-sync-${this.account}-${this.region}`,
        bucketName: this.inventoryBucket.bucketName,
        bucketRegion: this.region,
        syncFormat: 'JsonSerDe',
      },
    );
    // Depend on the construct (not just the CfnBucket) so the implicit
    // BucketPolicy granting `ssm.amazonaws.com` is in place before SSM's
    // pre-flight write test runs. Without this, CFN fails with the
    // uninformative "Invalid request provided: AWS::SSM::ResourceDataSync".
    this.resourceDataSync.node.addDependency(this.inventoryBucket);
    if (this.inventoryBucket.policy) {
      this.resourceDataSync.node.addDependency(this.inventoryBucket.policy);
    }

    // SSM Inventory association. `AWS-GatherSoftwareInventory` targets
    // all EC2 instances carrying the configured FIM tag and collects
    // File metadata for the monitored path.
    this.inventoryAssociation = new ssm.CfnAssociation(
      this,
      'InventoryAssociation',
      {
        name: 'AWS-GatherSoftwareInventory',
        associationName: 'fim-inventory-association',
        scheduleExpression: inventorySchedule,
        targets: [{key: `tag:${inventoryTagKey}`, values: [inventoryTagValue]}],
        parameters: {
          applications: ['Disabled'],
          awsComponents: ['Disabled'],
          networkConfig: ['Disabled'],
          windowsUpdates: ['Disabled'],
          instanceDetailedInformation: ['Disabled'],
          services: ['Disabled'],
          windowsRegistry: ['Disabled'],
          windowsRoles: ['Disabled'],
          customInventory: ['Disabled'],
          billingInfo: ['Disabled'],
          files: [
            // The AWS:File inventory plugin requires Pattern to be a list
            // of strings (not a single string); passing a bare string
            // fails on the agent with:
            //   "json: cannot unmarshal string into Go struct field
            //    filterObj.Pattern of type []string"
            JSON.stringify([
              {Path: props.monitoredPath, Pattern: ['*'], Recursive: true},
            ]),
          ],
        },
      },
    );

    // Stack outputs matching the upstream CloudFormation template.
    new CfnOutput(this, 'LoggingBucketName', {
      value: this.loggingBucket.bucketName,
    });
    new CfnOutput(this, 'InventoryBucketName', {
      value: this.inventoryBucket.bucketName,
    });
    new CfnOutput(this, 'ResourceDataSyncName', {
      value: this.resourceDataSync.ref,
    });
    new CfnOutput(this, 'InventoryAssociationId', {
      value: this.inventoryAssociation.ref,
    });
    new CfnOutput(this, 'LambdaFunctionName', {
      value: this.changeDetector.functionName,
    });
    new CfnOutput(this, 'LambdaFunctionArn', {
      value: this.changeDetector.functionArn,
    });
    new CfnOutput(this, 'DeadLetterQueueUrl', {
      value: this.deadLetterQueue.queueUrl,
    });
    new CfnOutput(this, 'DeadLetterQueueArn', {
      value: this.deadLetterQueue.queueArn,
    });
  }
}
