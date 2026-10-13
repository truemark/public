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
export interface AutoFimStackProps extends ExtendedStackProps {
  /** File system path on the EC2 instance to collect inventory for. */
  readonly monitoredPath: string;
  /** Comma-separated regex patterns identifying critical files. */
  readonly criticalFilePatterns: string;
  /** @default 'MEDIUM' */
  readonly findingSeverity?: string;
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
    const inventorySchedule = props.inventorySchedule ?? 'rate(30 minutes)';
    const inventoryTagKey = props.inventoryTagKey ?? 'FIM-Enabled';
    const inventoryTagValue = props.inventoryTagValue ?? 'true';

    // S3 logging bucket: receives server-access logs from the inventory
    // bucket. Immutable (Object Lock GOVERNANCE 90d), versioned, SSE-S3,
    // TLS-only. Mirrors `LoggingBucket` in template.yaml.
    this.loggingBucket = new s3.Bucket(this, 'LoggingBucket', {
      bucketName: `fim-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.governance(
        Duration.days(90),
      ),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.RETAIN,
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
    this.inventoryBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'SSMBucketPermissionsCheck',
        actions: ['s3:GetBucketAcl'],
        resources: [this.inventoryBucket.bucketArn],
        principals: [new iam.ServicePrincipal('ssm.amazonaws.com')],
      }),
    );
    this.inventoryBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'SSMBucketDelivery',
        actions: ['s3:PutObject'],
        resources: [`${this.inventoryBucket.bucketArn}/*`],
        principals: [new iam.ServicePrincipal('ssm.amazonaws.com')],
        conditions: {
          StringEquals: {'s3:x-amz-acl': 'bucket-owner-full-control'},
        },
      }),
    );

    // DLQ for the change-detector Lambda. 14-day retention per blog.
    this.deadLetterQueue = new sqs.Queue(this, 'ChangeDetectorDLQ', {
      queueName: 'fim-change-detector-dlq',
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
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
          `arn:aws:securityhub:${this.region}:${this.account}` +
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
    this.inventoryBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new LambdaDestination(this.changeDetector),
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
        targets: [
          {key: `tag:${inventoryTagKey}`, values: [inventoryTagValue]},
        ],
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
