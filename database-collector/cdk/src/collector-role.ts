import {ArnFormat, Stack} from 'aws-cdk-lib';
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import type {Construct} from 'constructs';

export interface CollectorRoleProps {
  /**
   * Name of the role. A fixed name lets database administrators and other
   * stacks refer to the role without looking it up.
   */
  readonly roleName: string;
  /**
   * Database user the collector logs in as when it authenticates with IAM
   * instead of a password.
   */
  readonly databaseUser: string;
  /** Prefix of the tags that opt a database in and configure it. */
  readonly tagPrefix: string;
}

/**
 * Execution role of the collector function.
 *
 * The role may request IAM database authentication tokens for
 * {@link CollectorRoleProps.databaseUser} on any RDS instance in the account
 * and region. That alone grants nothing: a database only accepts the token
 * once an administrator has created that user and enabled IAM authentication
 * for it.
 *
 * The role may also read secrets, but only those tagged for the collector:
 * either as a database to collect from (`enabled`) or as the credentials of a
 * tagged RDS instance (`allow`).
 */
export class CollectorRole extends Role {
  constructor(scope: Construct, id: string, props: CollectorRoleProps) {
    super(scope, id, {
      roleName: props.roleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description:
        'Used by Database Collector to connect to monitored databases',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole',
        ),
      ],
    });

    for (const tag of ['enabled', 'allow']) {
      this.addToPolicy(
        new PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              [`secretsmanager:ResourceTag/${props.tagPrefix}${tag}`]: 'true',
            },
          },
        }),
      );
    }

    this.addToPolicy(
      new PolicyStatement({
        actions: ['rds-db:connect'],
        resources: [
          Stack.of(this).formatArn({
            service: 'rds-db',
            resource: 'dbuser',
            resourceName: `*/${props.databaseUser}`,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );
  }
}
