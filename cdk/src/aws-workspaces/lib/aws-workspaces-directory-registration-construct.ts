import {Stack} from 'aws-cdk-lib';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Properties for AwsWorkspacesDirectoryRegistration.
 */
export interface AwsWorkspacesDirectoryRegistrationProps
  extends ExtendedConstructProps {
  /**
   * ID of the directory to register with WorkSpaces.
   */
  readonly directoryId: string;

  /**
   * Subnets to associate with the WorkSpaces directory.
   * WorkSpaces uses the first two subnets.
   */
  readonly subnets: ec2.ISubnet[];

  /**
   * The workspaces_DefaultRole IAM role.
   * The registration custom resource depends on this role existing first.
   */
  readonly workspacesRole: iam.IRole;
}

/**
 * Registers an AWS directory with WorkSpaces via a custom resource.
 *
 * Required before any WorkSpace can be provisioned against the directory.
 * Exposes the shared custom resource Lambda role and policy so callers can
 * attach additional permissions (e.g. SAML, certificate-based auth).
 *
 * Can be used independently of AwsWorkspaces when a directory registration
 * custom resource is needed in another context.
 */
export class AwsWorkspacesDirectoryRegistration extends ExtendedConstruct {
  /**
   * Shared custom resource Lambda role.
   * Pass to additional AwsCustomResource instances that should reuse the same Lambda.
   */
  readonly role: iam.Role;

  /**
   * Managed policy attached to role.
   * Call addStatements() to grant additional permissions (e.g. SAML, cert auth).
   */
  readonly policy: iam.ManagedPolicy;

  constructor(
    scope: Construct,
    id: string,
    props: AwsWorkspacesDirectoryRegistrationProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const stack = Stack.of(this);

    this.policy = new iam.ManagedPolicy(this, 'Policy', {
      managedPolicyName: `${stack.stackName}-workspaces-directory-registration`,
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowWorkspacesDirectoryRegistration',
          effect: iam.Effect.ALLOW,
          // RegisterWorkspaceDirectory validates the VPC/subnets and sets up the
          // directory's networking using the caller's credentials, so the Lambda
          // needs EC2 describe/networking permissions in addition to workspaces:/ds:/iam:
          // actions. Without ec2:* the API returns a generic access-denied error.
          actions: [
            'workspaces:RegisterWorkspaceDirectory',
            'workspaces:DeregisterWorkspaceDirectory',
            'workspaces:DescribeWorkspaceDirectories',
            'ds:DescribeDirectories',
            'ds:AuthorizeApplication',
            'ds:UnauthorizeApplication',
            'ds:EnableSso',
            'ds:DisableSso',
            'ec2:DescribeVpcs',
            'ec2:DescribeSubnets',
            'ec2:DescribeAvailabilityZones',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeRouteTables',
            'ec2:DescribeInternetGateways',
            'ec2:CreateNetworkInterface',
            'ec2:DeleteNetworkInterface',
            'ec2:CreateSecurityGroup',
            'ec2:DeleteSecurityGroup',
            'ec2:AuthorizeSecurityGroupIngress',
            'ec2:AuthorizeSecurityGroupEgress',
            'ec2:RevokeSecurityGroupIngress',
            'ec2:RevokeSecurityGroupEgress',
            'ec2:CreateTags',
            'iam:GetRole',
            'iam:CreateRole',
            'iam:AttachRolePolicy',
            'iam:PutRolePolicy',
            'iam:CreatePolicy',
            'iam:ListRoles',
            'iam:CreateServiceLinkedRole',
            'iam:PassRole',
          ],
          resources: ['*'],
        }),
      ],
    });

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
        this.policy,
      ],
    });

    const resource = new cr.AwsCustomResource(this, 'Resource', {
      onCreate: {
        service: 'WorkSpaces',
        action: 'RegisterWorkspaceDirectory',
        parameters: {
          DirectoryId: props.directoryId,
          SubnetIds: props.subnets.slice(0, 2).map((s) => s.subnetId),
          EnableWorkDocs: false,
          EnableSelfService: true,
          Tenancy: 'SHARED',
        },
        physicalResourceId: cr.PhysicalResourceId.of(props.directoryId),
        // InvalidResourceStateException: directory is already registered — treat as no-op.
        ignoreErrorCodesMatching: 'InvalidResourceStateException',
      },
      onUpdate: {
        service: 'WorkSpaces',
        action: 'DescribeWorkspaceDirectories',
        parameters: {DirectoryIds: [props.directoryId]},
        physicalResourceId: cr.PhysicalResourceId.of(props.directoryId),
      },
      onDelete: {
        service: 'WorkSpaces',
        action: 'DeregisterWorkspaceDirectory',
        parameters: {DirectoryId: props.directoryId},
        ignoreErrorCodesMatching:
          'InvalidResourceStateException|ResourceNotFoundException',
      },
      role: this.role,
    });
    resource.node.addDependency(props.workspacesRole);
  }
}
