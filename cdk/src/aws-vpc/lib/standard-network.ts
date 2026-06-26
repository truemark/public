import {CfnOutput, Stack, Tags} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import {NetworkParameters} from './network-parameters';

export type NatType = 'none' | 'single' | 'multi'; // TODO Add  | 'regional' | 'poor';

// TODO Need ipv6 support and we need to support ipv6 only

/**
 * Subnet sizing lookup table keyed by VPC prefix length.
 *
 * Mirrors the `private_subnets` and `subnets` locals in truemark/terraform-aws-vpc:
 *
 *   VPC     private newbits  private mask   other newbits   other mask
 *   /16          3               /19              6              /22
 *   /17          3               /20              5              /22
 *   /18          3               /21              5              /23
 *   /19          3               /22              5              /24
 *   /20          4               /24              5              /25
 *
 * "newbits" is the number of bits to extend the VPC prefix.
 * cidrMask = vpcPrefix + newbits.
 */
const SUBNET_NEWBITS: Record<number, {privateBits: number; otherBits: number}> =
  {
    16: {privateBits: 3, otherBits: 6},
    17: {privateBits: 3, otherBits: 5},
    18: {privateBits: 3, otherBits: 5},
    19: {privateBits: 3, otherBits: 5},
    20: {privateBits: 4, otherBits: 5},
  };

/**
 * Properties for StandardNetwork.
 */
export interface StandardNetworkProps extends ExtendedConstructProps {
  /**
   * Name for the VPC. Used as the VPC name tag and the SSM parameter path
   * segment (e.g. /network/{name}/vpc).
   */
  readonly name: string;

  /**
   * Full VPC CIDR block. e.g. "10.0.0.0/20".
   * Supported VPC prefix lengths for auto-sizing: /16, /17, /18, /19, /20.
   */
  readonly vpcCidr: string;

  // TODO Suggest both this and the terraform module default to 3
  /**
   * Number of availability zones to deploy subnets into. Default is 2.
   *
   * @default 2
   */
  readonly azCount?: number;

  /**
   * NAT gateway configuration. Default is NONE.
   *
   * @default NatType.NONE
   */
  readonly natType?: NatType;

  /**
   * Whether to create public subnets. Default is true.
   *
   * @default true
   */
  readonly createPublicSubnets?: boolean;

  /**
   * Whether to create private subnets (PRIVATE_WITH_EGRESS). Default is true.
   *
   * @default true
   */
  readonly createPrivateSubnets?: boolean;

  /**
   * Whether to create intra subnets (PRIVATE_ISOLATED, no egress). Default is true.
   *
   * @default true
   */
  readonly createIntraSubnets?: boolean;

  /**
   * Whether to create database subnets (PRIVATE_WITH_EGRESS). Default is true.
   *
   * @default true
   */
  readonly createDatabaseSubnets?: boolean;

  /**
   * Whether to create elasticache subnets (PRIVATE_WITH_EGRESS). Default is true.
   *
   * @default true
   */
  readonly createElasticacheSubnets?: boolean;

  /**
   * Whether to create redshift subnets (PRIVATE_WITH_EGRESS). Default is false.
   *
   * @default false
   */
  readonly createRedshiftSubnets?: boolean;

  /**
   * Apply a uniform CIDR mask to ALL subnet groups, overriding the terraform-style
   * auto-sizing. When set, all groups receive the same mask regardless of type.
   * Per-group overrides below take precedence over this value.
   */
  readonly subnetCidrMask?: number;

  /**
   * CIDR mask override for private subnets only.
   *
   * Equivalent to setting `private_newbits` in terraform-aws-vpc:
   *   privateSubnetCidrMask = vpcPrefix + private_newbits
   *
   * Takes precedence over subnetCidrMask and auto-sizing.
   */
  readonly privateSubnetCidrMask?: number;

  /**
   * CIDR mask override for public subnets only.
   *
   * Equivalent to setting `public_newbits` in terraform-aws-vpc:
   *   publicSubnetCidrMask = vpcPrefix + public_newbits
   *
   * Takes precedence over subnetCidrMask and auto-sizing.
   */
  readonly publicSubnetCidrMask?: number;

  /**
   * CIDR mask override for intra subnets only.
   *
   * Equivalent to setting `intra_newbits` in terraform-aws-vpc.
   * Takes precedence over subnetCidrMask and auto-sizing.
   */
  readonly intraSubnetCidrMask?: number;

  /**
   * CIDR mask override for database subnets only.
   *
   * Equivalent to setting `database_newbits` in terraform-aws-vpc.
   * Takes precedence over subnetCidrMask and auto-sizing.
   */
  readonly databaseSubnetCidrMask?: number;

  /**
   * CIDR mask override for elasticache subnets only.
   *
   * Equivalent to setting `elasticache_newbits` in terraform-aws-vpc.
   * Takes precedence over subnetCidrMask and auto-sizing.
   */
  readonly elasticacheSubnetCidrMask?: number;

  /**
   * CIDR mask override for redshift subnets only.
   *
   * Equivalent to setting `redshift_newbits` in terraform-aws-vpc.
   * Takes precedence over subnetCidrMask and auto-sizing.
   */
  readonly redshiftSubnetCidrMask?: number;

  /**
   * Whether to create an S3 gateway VPC endpoint. The endpoint is attached to
   * private, database, elasticache, redshift, and intra subnets (whichever are
   * enabled). Default is true.
   *
   * @default true
   */
  readonly createS3Endpoint?: boolean;

  /**
   * Whether to create a DynamoDB gateway VPC endpoint. Attached to the same
   * subnet groups as the S3 endpoint. Default is true.
   *
   * @default true
   */
  readonly createDynamoDbEndpoint?: boolean;

  /**
   * Whether to store VPC and subnet IDs in AWS SSM Parameter Store via the
   * NetworkParameters construct. Default is true.
   *
   * @default true
   */
  readonly storeParameters?: boolean;

  /**
   * SSM parameter prefix used when storeParameters is true. Default is "/network".
   *
   * @default "/network"
   */
  readonly parametersPrefix?: string;

  /**
   * Whether to create CloudFormation stack outputs for VPC and subnet IDs.
   * Default is true.
   *
   * @default true
   */
  readonly createOutputs?: boolean;

  /**
   * Additional tags to apply to public subnets.
   */
  readonly publicSubnetTags?: Record<string, string>;

  /**
   * Additional tags to apply to private subnets.
   */
  readonly privateSubnetTags?: Record<string, string>;

  /**
   * Additional tags to apply to intra subnets.
   */
  readonly intraSubnetTags?: Record<string, string>;

  /**
   * Additional tags to apply to database subnets.
   */
  readonly databaseSubnetTags?: Record<string, string>;

  /**
   * Additional tags to apply to elasticache subnets.
   */
  readonly elasticacheSubnetTags?: Record<string, string>;

  /**
   * Additional tags to apply to redshift subnets.
   */
  readonly redshiftSubnetTags?: Record<string, string>;
}

/**
 * Resolved CIDR mask for each subnet group.
 */
interface ResolvedSubnetMasks {
  private: number;
  public: number;
  intra: number;
  database: number;
  elasticache: number;
  redshift: number;
}

/**
 * Determines the CIDR masks for each subnet group.
 *
 * Resolution order (highest wins):
 *   1. Per-group override (e.g. privateSubnetCidrMask)
 *   2. Uniform override  (subnetCidrMask)
 *   3. Terraform-table auto-sizing from the VPC prefix
 */
function resolveSubnetMasks(
  vpcCidr: string,
  props: StandardNetworkProps,
): ResolvedSubnetMasks {
  const vpcPrefix = Number(vpcCidr.split('/')[1]);

  if (!Number.isFinite(vpcPrefix)) {
    throw new Error(`Invalid VPC CIDR: ${vpcCidr}`);
  }

  // --- Auto-sizing from terraform tables ---
  const bits = SUBNET_NEWBITS[vpcPrefix];

  let autoPrivate: number;
  let autoOther: number;

  if (bits) {
    autoPrivate = vpcPrefix + bits.privateBits;
    autoOther = vpcPrefix + bits.otherBits;
  } else if (props.subnetCidrMask !== undefined) {
    // Fall back to uniform when VPC prefix is outside the table range
    autoPrivate = props.subnetCidrMask;
    autoOther = props.subnetCidrMask;
  } else {
    throw new Error(
      `VPC prefix /${vpcPrefix} is not in the auto-sizing table (supported: /16–/20). ` +
        `Provide subnetCidrMask or per-group overrides.`,
    );
  }

  // Uniform override replaces both private and other defaults
  const uniformMask = props.subnetCidrMask;
  const baseMaskPrivate = uniformMask ?? autoPrivate;
  const baseMaskOther = uniformMask ?? autoOther;

  return {
    private: props.privateSubnetCidrMask ?? baseMaskPrivate,
    public: props.publicSubnetCidrMask ?? baseMaskOther,
    intra: props.intraSubnetCidrMask ?? baseMaskOther,
    database: props.databaseSubnetCidrMask ?? baseMaskOther,
    elasticache: props.elasticacheSubnetCidrMask ?? baseMaskOther,
    redshift: props.redshiftSubnetCidrMask ?? baseMaskOther,
  };
}

/**
 * Validates that the VPC CIDR has enough address space for all enabled subnet
 * groups. Each group consumes azCount × 2^(32-cidrMask) IPs.
 */
function validateAddressSpace(
  vpcCidr: string,
  azCount: number,
  enabledGroups: {mask: number; name: string}[],
): void {
  const vpcPrefix = Number(vpcCidr.split('/')[1]);
  const vpcIps = 2 ** (32 - vpcPrefix);
  let requiredIps = 0;
  const detail: string[] = [];

  for (const g of enabledGroups) {
    const subnetIps = 2 ** (32 - g.mask);
    const groupIps = azCount * subnetIps;
    requiredIps += groupIps;
    detail.push(`${g.name}: ${azCount} × /${g.mask} = ${groupIps} IPs`);
  }

  if (requiredIps > vpcIps) {
    throw new Error(
      `VPC CIDR ${vpcCidr} (${vpcIps} IPs) is too small.\n` +
        `Required: ${requiredIps} IPs across ${enabledGroups.length} subnet groups:\n` +
        detail.map((d) => `  ${d}`).join('\n') +
        '\nIncrease the VPC size, reduce azCount, or disable some subnet groups.',
    );
  }
}

function applySubnetTags(
  subnets: ec2.ISubnet[],
  tags: Record<string, string>,
): void {
  for (const subnet of subnets) {
    for (const [key, value] of Object.entries(tags)) {
      Tags.of(subnet).add(key, value);
    }
  }
}

/**
 * Creates a standard multi-tier VPC following TrueMark conventions, with subnet
 * sizing that mirrors the truemark/terraform-aws-vpc Terraform module.
 *
 * **Subnet layout** (each group is replicated across all AZs):
 *
 * | Group       | Type                | Default sizing (auto, see table below) |
 * |-------------|---------------------|----------------------------------------|
 * | private     | PRIVATE_WITH_EGRESS | Larger — sized for workload traffic    |
 * | public      | PUBLIC              | Smaller                                |
 * | intra       | PRIVATE_ISOLATED    | Smaller — no egress                    |
 * | database    | PRIVATE_WITH_EGRESS | Smaller                                |
 * | elasticache | PRIVATE_WITH_EGRESS | Smaller                                |
 * | redshift    | PRIVATE_WITH_EGRESS | Smaller (disabled by default)          |
 *
 * **Auto-sizing table** (matches terraform-aws-vpc `private_subnets`/`subnets` locals):
 *
 * | VPC    | private | public/intra/database/elasticache/redshift |
 * |--------|---------|---------------------------------------------|
 * | /16    | /19     | /22                                         |
 * | /17    | /20     | /22                                         |
 * | /18    | /21     | /23                                         |
 * | /19    | /22     | /24                                         |
 * | /20    | /24     | /25                                         |
 *
 * Override sizing via `subnetCidrMask` (uniform) or per-group props like
 * `privateSubnetCidrMask`, `publicSubnetCidrMask`, etc. — equivalent to the
 * `private_newbits`, `public_newbits`, ... variables in Terraform.
 *
 * > **Note on CIDR placement:** CDK allocates subnet CIDRs sequentially from
 * > the start of the VPC CIDR block. This differs from Terraform's placement,
 * > which uses explicit `netnum` offsets to position subnet groups at specific
 * > addresses within the VPC. The subnet *sizes* match exactly; only the
 * > starting addresses within the VPC differ.
 *
 * Gateway VPC endpoints for S3 and DynamoDB are created by default and attached
 * to private, intra, database, elasticache, and redshift route tables.
 *
 * VPC and subnet IDs are stored in AWS SSM Parameter Store via NetworkParameters
 * and optionally exported as CloudFormation outputs.
 */
export class StandardNetwork extends ExtendedConstruct {
  /**
   * The VPC created by this construct.
   */
  readonly vpc: ec2.Vpc;

  /**
   * The NetworkParameters construct holding SSM paths and created parameters.
   * Undefined when storeParameters is false.
   */
  readonly networkParameters?: NetworkParameters;

  constructor(scope: Construct, id: string, props: StandardNetworkProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    // TODO You change the default here Daren
    const azCount = props.azCount ?? 2;
    const natType = props.natType ?? 'none';

    const natGateways =
      natType === 'multi' ? azCount : natType === 'single' ? 1 : 0;

    // TODO Need to add support for regional NAT
    // TODO Need to add support for poor NAT

    // TODO Need to add support for network firewall

    const createPublic = props.createPublicSubnets ?? true;
    const createPrivate = props.createPrivateSubnets ?? true;
    const createIntra = props.createIntraSubnets ?? true;
    const createDatabase = props.createDatabaseSubnets ?? true;
    const createElasticache = props.createElasticacheSubnets ?? true;
    const createRedshift = props.createRedshiftSubnets ?? false;

    const masks = resolveSubnetMasks(props.vpcCidr, props);

    const enabledGroups: {mask: number; name: string}[] = [];
    if (createPublic) enabledGroups.push({mask: masks.public, name: 'public'});
    if (createPrivate)
      enabledGroups.push({mask: masks.private, name: 'private'});
    if (createIntra) enabledGroups.push({mask: masks.intra, name: 'intra'});
    if (createDatabase)
      enabledGroups.push({mask: masks.database, name: 'database'});
    if (createElasticache)
      enabledGroups.push({mask: masks.elasticache, name: 'elasticache'});
    if (createRedshift)
      enabledGroups.push({mask: masks.redshift, name: 'redshift'});

    validateAddressSpace(props.vpcCidr, azCount, enabledGroups);

    const subnetConfiguration: ec2.SubnetConfiguration[] = [];

    if (createPrivate) {
      subnetConfiguration.push({
        name: 'private',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: masks.private,
      });
    }
    if (createPublic) {
      subnetConfiguration.push({
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: masks.public,
      });
    }
    if (createIntra) {
      subnetConfiguration.push({
        name: 'intra',
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: masks.intra,
      });
    }
    if (createDatabase) {
      subnetConfiguration.push({
        name: 'database',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: masks.database,
      });
    }
    if (createElasticache) {
      subnetConfiguration.push({
        name: 'elasticache',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: masks.elasticache,
      });
    }
    if (createRedshift) {
      subnetConfiguration.push({
        name: 'redshift',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: masks.redshift,
      });
    }

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: props.name,
      maxAzs: azCount,
      natGateways,
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr),
      subnetConfiguration,
    });

    // Apply per-subnet-group tags
    if (props.publicSubnetTags && createPublic) {
      applySubnetTags(
        this.vpc.selectSubnets({subnetGroupName: 'public'}).subnets,
        props.publicSubnetTags,
      );
    }
    if (props.privateSubnetTags && createPrivate) {
      applySubnetTags(
        this.vpc.selectSubnets({subnetGroupName: 'private'}).subnets,
        props.privateSubnetTags,
      );
    }
    if (props.intraSubnetTags && createIntra) {
      applySubnetTags(
        this.vpc.selectSubnets({subnetGroupName: 'intra'}).subnets,
        props.intraSubnetTags,
      );
    }
    if (props.databaseSubnetTags && createDatabase) {
      applySubnetTags(
        this.vpc.selectSubnets({subnetGroupName: 'database'}).subnets,
        props.databaseSubnetTags,
      );
    }
    if (props.elasticacheSubnetTags && createElasticache) {
      applySubnetTags(
        this.vpc.selectSubnets({subnetGroupName: 'elasticache'}).subnets,
        props.elasticacheSubnetTags,
      );
    }
    if (props.redshiftSubnetTags && createRedshift) {
      applySubnetTags(
        this.vpc.selectSubnets({subnetGroupName: 'redshift'}).subnets,
        props.redshiftSubnetTags,
      );
    }

    // Build the list of subnet groups for gateway endpoint route tables.
    const endpointSubnets: ec2.SubnetSelection[] = [];
    if (createPrivate) endpointSubnets.push({subnetGroupName: 'private'});
    if (createIntra) endpointSubnets.push({subnetGroupName: 'intra'});
    if (createDatabase) endpointSubnets.push({subnetGroupName: 'database'});
    if (createElasticache)
      endpointSubnets.push({subnetGroupName: 'elasticache'});
    if (createRedshift) endpointSubnets.push({subnetGroupName: 'redshift'});

    if ((props.createS3Endpoint ?? true) && endpointSubnets.length > 0) {
      this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
        service: ec2.GatewayVpcEndpointAwsService.S3,
        subnets: endpointSubnets,
      });
    }

    if ((props.createDynamoDbEndpoint ?? true) && endpointSubnets.length > 0) {
      this.vpc.addGatewayEndpoint('DynamoDbGatewayEndpoint', {
        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
        subnets: endpointSubnets,
      });
    }

    // CloudFormation outputs
    if (props.createOutputs ?? true) {
      const stackName = Stack.of(this).stackName;

      new CfnOutput(this, 'VpcId', {
        value: this.vpc.vpcId,
        exportName: `${stackName}:VpcId`,
      });

      if (createPublic) {
        new CfnOutput(this, 'PublicSubnetIds', {
          value: this.vpc
            .selectSubnets({subnetGroupName: 'public'})
            .subnetIds.join(','),
          exportName: `${stackName}:PublicSubnetIds`,
        });
      }
      if (createPrivate) {
        new CfnOutput(this, 'PrivateSubnetIds', {
          value: this.vpc
            .selectSubnets({subnetGroupName: 'private'})
            .subnetIds.join(','),
          exportName: `${stackName}:PrivateSubnetIds`,
        });
      }
      if (createIntra) {
        new CfnOutput(this, 'IntraSubnetIds', {
          value: this.vpc
            .selectSubnets({subnetGroupName: 'intra'})
            .subnetIds.join(','),
          exportName: `${stackName}:IntraSubnetIds`,
        });
      }
      if (createDatabase) {
        new CfnOutput(this, 'DatabaseSubnetIds', {
          value: this.vpc
            .selectSubnets({subnetGroupName: 'database'})
            .subnetIds.join(','),
          exportName: `${stackName}:DatabaseSubnetIds`,
        });
      }
      if (createElasticache) {
        new CfnOutput(this, 'ElasticacheSubnetIds', {
          value: this.vpc
            .selectSubnets({subnetGroupName: 'elasticache'})
            .subnetIds.join(','),
          exportName: `${stackName}:ElasticacheSubnetIds`,
        });
      }
      if (createRedshift) {
        new CfnOutput(this, 'RedshiftSubnetIds', {
          value: this.vpc
            .selectSubnets({subnetGroupName: 'redshift'})
            .subnetIds.join(','),
          exportName: `${stackName}:RedshiftSubnetIds`,
        });
      }
    }

    // SSM Parameter Store via NetworkParameters
    if (props.storeParameters ?? true) {
      this.networkParameters = new NetworkParameters(
        this,
        'NetworkParameters',
        {
          name: props.name,
          prefix: props.parametersPrefix,
          create: true,
          lookupVpc: false,
          lookupAzs: false,
          lookupPublicSubnets: false,
          lookupPrivateSubnets: false,
          lookupIntraSubnets: false,
          lookupDatabaseSubnets: false,
          lookupElasticacheSubnets: false,
          lookupRedshiftSubnets: false,
          lookupOutpostSubnets: false,
          vpcId: this.vpc.vpcId,
          azs: this.vpc.availabilityZones,
          publicSubnetIds: createPublic
            ? this.vpc.selectSubnets({subnetGroupName: 'public'}).subnetIds
            : undefined,
          privateSubnetIds: createPrivate
            ? this.vpc.selectSubnets({subnetGroupName: 'private'}).subnetIds
            : undefined,
          intraSubnetIds: createIntra
            ? this.vpc.selectSubnets({subnetGroupName: 'intra'}).subnetIds
            : undefined,
          databaseSubnetIds: createDatabase
            ? this.vpc.selectSubnets({subnetGroupName: 'database'}).subnetIds
            : undefined,
          elasticacheSubnetIds: createElasticache
            ? this.vpc.selectSubnets({subnetGroupName: 'elasticache'}).subnetIds
            : undefined,
          redshiftSubnetIds: createRedshift
            ? this.vpc.selectSubnets({subnetGroupName: 'redshift'}).subnetIds
            : undefined,
        },
      );
    }
  }
}
