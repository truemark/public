import {Construct} from 'constructs';
import {
  AddToPrincipalPolicyResult,
  Grant,
  IManagedPolicy,
  IPrincipal,
  IRole,
  Policy,
  PolicyStatement,
  PrincipalPolicyFragment,
  Role,
  RoleReference,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {ResourceEnvironment, RemovalPolicy, Stack} from 'aws-cdk-lib';

export interface DestinationBucketOptions {
  readonly bucketName: string;
  readonly region?: string;
  readonly account?: string;
}
export interface ReplicationRoleProps {
  readonly sourceBucketName: string;
  readonly destinationBuckets: DestinationBucketOptions[];
}

export class ReplicationRole extends Construct implements IRole {
  readonly roleRef: RoleReference;
  readonly role: Role;
  readonly roleArn: string;
  readonly roleName: string;
  readonly assumeRoleAction: string;
  readonly policyFragment: PrincipalPolicyFragment;
  readonly principalAccount?: string;
  readonly grantPrincipal: IPrincipal;
  readonly stack: Stack;
  readonly env: ResourceEnvironment;

  constructor(scope: Construct, id: string, props: ReplicationRoleProps) {
    super(scope, id);

    const stack = Stack.of(this);

    const replicationRole = new Role(this, 'Default', {
      assumedBy: new ServicePrincipal('s3.amazonaws.com'),
    });

    replicationRole.addToPolicy(
      new PolicyStatement({
        actions: [
          's3:ListBucket',
          's3:GetReplicationConfiguration',
          's3:GetObjectVersionForReplication',
          's3:GetObjectVersionAcl',
          's3:GetObjectVersionTagging',
          's3:GetObjectRetention',
          's3:GetObjectLegalHold',
        ],
        resources: [
          `arn:aws:s3:::${props.sourceBucketName}`,
          `arn:aws:s3:::${props.sourceBucketName}/*`,
          ...props.destinationBuckets.map(
            (dest) => `arn:aws:s3:::${dest.bucketName}`,
          ),
          ...props.destinationBuckets.map(
            (dest) => `arn:aws:s3:::${dest.bucketName}/*`,
          ),
        ],
      }),
    );
    replicationRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:Replicate*', 's3:ObjectOwnerOverrideToBucketOwner'],
        resources: [
          `arn:aws:s3:::${props.sourceBucketName}/*`,
          ...props.destinationBuckets.map(
            (dest) => `arn:aws:s3:::${dest.bucketName}/*`,
          ),
        ],
      }),
    );
    replicationRole.addToPolicy(
      new PolicyStatement({
        actions: ['kms:Encrypt'],
        resources: props.destinationBuckets.map(
          (dest) =>
            `arn:aws:kms:${dest.region ?? stack.region}:${
              dest.account ?? stack.account
            }:key/*`,
        ),
      }),
    );
    replicationRole.addToPolicy(
      new PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${stack.region}:${stack.account}:key/*`],
      }),
    );

    this.roleRef = replicationRole.roleRef;
    this.role = replicationRole;
    this.roleArn = replicationRole.roleArn;
    this.roleName = replicationRole.roleName;
    this.assumeRoleAction = replicationRole.assumeRoleAction;
    this.policyFragment = replicationRole.policyFragment;
    this.principalAccount = replicationRole.principalAccount;
    this.grantPrincipal = replicationRole.grantPrincipal;
    this.stack = replicationRole.stack;
    this.env = replicationRole.env;
  }

  grant(grantee: IPrincipal, ...actions: string[]): Grant {
    return this.role.grant(grantee, ...actions);
  }

  grantPassRole(grantee: IPrincipal): Grant {
    return this.role.grantPassRole(grantee);
  }

  grantAssumeRole(grantee: IPrincipal): Grant {
    return this.role.grantAssumeRole(grantee);
  }

  addToPrincipalPolicy(statement: PolicyStatement): AddToPrincipalPolicyResult {
    return this.role.addToPrincipalPolicy(statement);
  }

  attachInlinePolicy(policy: Policy) {
    return this.role.attachInlinePolicy(policy);
  }

  addManagedPolicy(policy: IManagedPolicy) {
    return this.role.addManagedPolicy(policy);
  }

  applyRemovalPolicy(policy: RemovalPolicy) {
    return this.role.applyRemovalPolicy(policy);
  }
}
