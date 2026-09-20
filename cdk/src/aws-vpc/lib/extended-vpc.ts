import {Tags} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type {Construct} from 'constructs';

/**
 * Properties for ExtendedVpc.
 */
export interface ExtendedVpcProps extends ec2.VpcProps {
  /**
   * Additional tags to apply to subnets, keyed by subnet group name.
   *
   * e.g. `{private: {'kubernetes.io/role/internal-elb': '1'}}`
   */
  readonly subnetGroupTags?: Record<string, Record<string, string>>;

  /**
   * Whether to create an S3 gateway VPC endpoint. Default is false.
   *
   * @default false
   */
  readonly createS3Endpoint?: boolean;

  /**
   * Whether to create a DynamoDB gateway VPC endpoint. Default is false.
   *
   * @default false
   */
  readonly createDynamoDbEndpoint?: boolean;

  /**
   * Subnets whose route tables the gateway endpoints are attached to.
   *
   * @default - all non-public subnet groups
   */
  readonly gatewayEndpointSubnets?: ec2.SubnetSelection[];
}

/**
 * Extension of Vpc with support for per-subnet-group tags, S3 and DynamoDB
 * gateway endpoints, and convenience methods for working with subnet groups.
 *
 * Benefits over using Vpc directly:
 *
 * - **Gateway endpoints in one flag.** `createS3Endpoint` and
 *   `createDynamoDbEndpoint` attach free gateway endpoints to every non-public
 *   subnet group by default, so S3 and DynamoDB traffic bypasses NAT gateways
 *   and avoids NAT data processing charges.
 * - **Tags by subnet group.** `subnetGroupTags` applies tags to all subnets in
 *   a named group (e.g. load balancer discovery tags for EKS). An unknown group
 *   name throws instead of silently tagging nothing.
 * - **Safe subnet group lookups.** `subnetGroupIds` returns undefined for a
 *   missing group where `selectSubnets` throws, and `hasSubnetGroup` and
 *   `subnetGroupNames` expose the layout for conditional logic.
 * - **Drop-in replacement.** This is a Vpc, not a wrapper, so it can be passed
 *   anywhere an IVpc is accepted.
 *
 * This construct is unopinionated about subnet layout and sizing. For a
 * standard TrueMark multi-tier network see StandardNetwork, which builds on
 * this class.
 */
export class ExtendedVpc extends ec2.Vpc {
  /**
   * Names of the subnet groups created in this VPC, in configuration order.
   */
  readonly subnetGroupNames: string[];

  /**
   * The S3 gateway endpoint, if created.
   */
  readonly s3GatewayEndpoint?: ec2.GatewayVpcEndpoint;

  /**
   * The DynamoDB gateway endpoint, if created.
   */
  readonly dynamoDbGatewayEndpoint?: ec2.GatewayVpcEndpoint;

  constructor(scope: Construct, id: string, props: ExtendedVpcProps) {
    super(scope, id, props);

    // Mirrors the defaulting Vpc applies when subnetConfiguration is omitted.
    const subnetConfiguration = (
      props.subnetConfiguration ??
      (props.natGateways === 0
        ? ec2.Vpc.DEFAULT_SUBNETS_NO_NAT
        : ec2.Vpc.DEFAULT_SUBNETS)
    ).filter((c) => !c.reserved);

    this.subnetGroupNames = subnetConfiguration.map((c) => c.name);

    for (const [groupName, tags] of Object.entries(
      props.subnetGroupTags ?? {},
    )) {
      if (!this.hasSubnetGroup(groupName)) {
        throw new Error(
          `Cannot apply tags to subnet group "${groupName}": no such group.`,
        );
      }
      for (const subnet of this.selectSubnets({subnetGroupName: groupName})
        .subnets) {
        for (const [key, value] of Object.entries(tags)) {
          Tags.of(subnet).add(key, value);
        }
      }
    }

    const endpointSubnets =
      props.gatewayEndpointSubnets ??
      subnetConfiguration
        .filter((c) => c.subnetType !== ec2.SubnetType.PUBLIC)
        .map((c) => ({subnetGroupName: c.name}));

    if (endpointSubnets.length > 0) {
      if (props.createS3Endpoint ?? false) {
        this.s3GatewayEndpoint = this.addGatewayEndpoint('S3GatewayEndpoint', {
          service: ec2.GatewayVpcEndpointAwsService.S3,
          subnets: endpointSubnets,
        });
      }
      if (props.createDynamoDbEndpoint ?? false) {
        this.dynamoDbGatewayEndpoint = this.addGatewayEndpoint(
          'DynamoDbGatewayEndpoint',
          {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
            subnets: endpointSubnets,
          },
        );
      }
    }
  }

  /**
   * Returns true if a subnet group with the given name exists in this VPC.
   *
   * @param groupName the subnet group name
   */
  hasSubnetGroup(groupName: string): boolean {
    return this.subnetGroupNames.includes(groupName);
  }

  /**
   * Returns the subnet IDs in the given subnet group, or undefined if the
   * group does not exist.
   *
   * @param groupName the subnet group name
   */
  subnetGroupIds(groupName: string): string[] | undefined {
    return this.hasSubnetGroup(groupName)
      ? this.selectSubnets({subnetGroupName: groupName}).subnetIds
      : undefined;
  }
}
