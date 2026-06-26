import {Construct} from 'constructs';
import {StringListParameter, StringParameter} from 'aws-cdk-lib/aws-ssm';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Properties for NetworkParameters.
 */
export interface NetworkParametersProps extends ExtendedConstructProps {
  /**
   * Name of the network. This is normally the name of your VPC.
   */
  readonly name: string;

  /**
   * Prefix from which to store and retrieve parameters. Default is "/network".
   *
   * @default - "/network"
   */
  readonly prefix?: string;

  /**
   * Setting this to false will disable the creation of resources in this construct. Default is true.
   *
   * @default - true
   */
  readonly create?: boolean;

  /**
   * Setting this to true will suppress the creation of default tags on resources created by this
   * construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;

  /**
   * VPC ID to store.
   */
  readonly vpcId?: string;

  /**
   * Availability-zone values to store.
   */
  readonly azs?: string[];

  /**
   * Public subnet IDs to store.
   */
  readonly publicSubnetIds?: string[];

  /**
   * Private subnet IDs to store.
   */
  readonly privateSubnetIds?: string[];

  /**
   * Intra subnet IDs to store.
   */
  readonly intraSubnetIds?: string[];

  /**
   * Redshift subnet IDs to store.
   */
  readonly redshiftSubnetIds?: string[];

  /**
   * Database subnet IDs to store.
   */
  readonly databaseSubnetIds?: string[];

  /**
   * Elasticache subnet IDs to store.
   */
  readonly elasticacheSubnetIds?: string[];

  /**
   * Outpost subnet IDs to store.
   */
  readonly outpostSubnetIds?: string[];

  /**
   * Public ALB ARNs to store.
   */
  readonly publicAlbArns?: string[];

  /**
   * Private ALB ARNs to store.
   */
  readonly privateAlbArns?: string[];

  /**
   * Certificate ARNs on public ALBs to store. Indexes should match publicAlbArns.
   */
  readonly publicAlbCertificateArns?: string[];

  /**
   * Certificate ARNs on private ALBs to store. Indexes should match privateAlbArns.
   */
  readonly privateAlbCertificateArns?: string[];

  /**
   * Alternative public ALB ARNs to store.
   */
  readonly altPublicAlbArns?: string[];

  /**
   * Alternative private ALB ARNs to store.
   */
  readonly altPrivateAlbArns?: string[];

  /**
   * Alternative certificate ARNs on public ALBs to store. Indexes should match publicAlbArns.
   */
  readonly altPublicAlbCertificateArns?: string[];

  /**
   * Alternative certificate ARNs on private ALBs to store. Indexes should match privateAlbArns.
   */
  readonly altPrivateAlbCertificateArns?: string[];

  /**
   * Public certificate ARN to store for this network.
   */
  readonly publicCertificateArn?: string;

  /**
   * Private certificate ARN to store for this network.
   */
  readonly privateCertificateArn?: string;

  /**
   * CloudFront certificate ARN to store for this network.
   */
  readonly cloudFontCertificateArn?: string;

  /**
   * Public zone name to store for this network.
   */
  readonly publicZoneName?: string;

  /**
   * Private zone name to store for this network.
   */
  readonly privateZoneName?: string;

  /**
   * Lookup VPC value if not provided. Default is true.
   *
   * @default - true
   */
  readonly lookupVpc?: boolean;

  /**
   * Lookup availability zones if not provided. Default is true.
   *
   * @default - true
   */
  readonly lookupAzs?: boolean;

  /**
   * Lookup public subnets if not provided. Default is true.
   *
   * @default - true
   */
  readonly lookupPublicSubnets?: boolean;

  /**
   * Lookup private subnets if not provided. Default is true.
   *
   * @default - true
   */
  readonly lookupPrivateSubnets?: boolean;

  /**
   * Lookup intra subnets if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupIntraSubnets?: boolean;

  /**
   * Lookup redshift subnets if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupRedshiftSubnets?: boolean;

  /**
   * Lookup database subnets if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupDatabaseSubnets?: boolean;

  /**
   * Lookup elasticache subnets if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupElasticacheSubnets?: boolean;

  /**
   * Lookup outpost subnets if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupOutpostSubnets?: boolean;

  /**
   * Lookup public ALBs if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupPublicAlbs?: boolean;

  /**
   * Lookup private ALBs if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupPrivateAlbs?: boolean;

  /**
   * Lookup ACM certificates on public ALBs if provided. Default is false.
   */
  readonly lookupPublicAlbCertificates?: boolean;

  /**
   * Lookup ACM certificates on private ALBs if provided. Default is false.
   */
  readonly lookupPrivateAlbCertificates?: boolean;

  /**
   * Lookup alternative public ALBs if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupAltPublicAlbs?: boolean;

  /**
   * Lookup alternative private ALBs if not provided. Default is false.
   *
   * @default - false
   */
  readonly lookupAltPrivateAlbs?: boolean;

  /**
   * Lookup alternative ACM certificates on public ALBs if provided. Default is false.
   *
   * @default - false
   */
  readonly lookupAltPublicAlbCertificates?: boolean;

  /**
   * Lookup alternative ACM certificates on private ALBs if provided. Default is false.
   *
   * @default - false
   */
  readonly lookupAltPrivateAlbCertificates?: boolean;

  /**
   * Lookup public certificate. Default is false.
   *
   * @default - false
   */
  readonly lookupPublicCertificate?: boolean;

  /**
   * Lookup private certificate. Default is false.
   *
   * @default - false
   */
  readonly lookupPrivateCertificate?: boolean;

  /**
   * Lookup CloudFront certificate. Default is false.
   *
   * @default - false
   */
  readonly lookupCloudFrontCertificate?: boolean;

  /**
   * Lookup public zone. Default is false.
   *
   * @default - false
   */
  readonly lookupPublicZone?: boolean;

  /**
   * Lookup private zone. Default is false.
   *
   * @default - false
   */
  readonly lookupPrivateZone?: boolean;
}

/**
 * Stores and retrieves network infrastructure identifiers using
 * AWS Systems Manager Parameter Store.
 */
export class NetworkParameters extends ExtendedConstruct {
  /**
   * Path to the VPC ID
   */
  readonly vpcParameterPath: string;

  /**
   * Path to the availability zones
   */
  readonly azsParameterPath: string;

  /**
   * Path to the public subnet IDs
   */
  readonly publicSubnetsParameterPath: string;

  /**
   * Path to the private subnet IDs
   */
  readonly privateSubnetsParameterPath: string;

  /**
   * Path to the intra subnet IDs
   */
  readonly intraSubnetsParameterPath: string;

  /**
   * Path to the redshift subnet IDs
   */
  readonly redshiftSubnetsParameterPath: string;

  /**
   * Path to the database subnet IDs
   */
  readonly databaseSubnetsParameterPath: string;

  /**
   * Path to the elasticache subnet IDs
   */
  readonly elasticacheSubnetsParameterPath: string;

  /**
   * Path to the outpost subnet IDs.
   */
  readonly outpostSubnetsParameterPath: string;

  /**
   * Path to the public ALB ARNs.
   */
  readonly publicAlbsParameterPath: string;

  /**
   * Path to the private ALB ARNs.
   */
  readonly privateAlbsParameterPath: string;

  /**
   * Path to the certificate ARNs on the public ALBs.
   */
  readonly publicAlbCertificatesParameterPath: string;

  /**
   * Path to the certificate ARNs on the private ALBs.
   */
  readonly privateAlbCertificatesParameterPath: string;

  /**
   * Path to the alternative public ALB ARNs.
   */
  readonly altPublicAlbsParameterPath: string;

  /**
   * Path to the alternative private ALB ARNs.
   */
  readonly altPrivateAlbsParameterPath: string;

  /**
   * Path to the alternative certificate ARNs on the public ALBs.
   */
  readonly altPublicAlbCertificatesParameterPath: string;

  /**
   * Path to the alternative certificate ARNs on the private ALBs.
   */
  readonly altPrivateAlbCertificatesParameterPath: string;

  /**
   * Path to the public certificate ARN.
   */
  readonly publicCertificateParameterPath: string;

  /**
   * Path to the private certificate ARN.
   */
  readonly privateCertificateParameterPath: string;

  /**
   * Path to the CloudFront certiticate ARN.
   */
  readonly cloudFrontCertificateParameterPath: string;

  /**
   * Path to the public zone.
   */
  readonly publicZoneParameterPath: string;

  /**
   * Path to the private zone.
   */
  readonly privateZoneParameterPath: string;

  /**
   * The parameter created if vpcId was provided.
   */
  readonly vpcParameter?: StringParameter;

  /**
   * The parameter created if azs were provided.
   */
  readonly azsParameter?: StringListParameter;

  /**
   * The parameter crated if publicSubnetIds were provided.
   */
  readonly publicSubnetsParameter?: StringListParameter;

  /**
   * The parameter created if privateSubnetIds were provided.
   */
  readonly privateSubnetsParameter?: StringListParameter;

  /**
   * The parameter created if intraSubnetIds were provided.
   */
  readonly intraSubnetsParameter?: StringListParameter;

  /**
   * The parameter created if redshiftSubnetIds were provided.
   */
  readonly redshiftSubnetsParameter?: StringListParameter;

  /**
   * The parameter created if databaseSubnetIds were provided.
   */
  readonly databaseSubnetsParameter?: StringListParameter;

  /**
   * The parameter created if elasticacheSubnetIds were provided.
   */
  readonly elasticacheSubnetsParameter?: StringListParameter;

  /**
   * The parameter created if outpostSubnetIds were provided.
   */
  readonly outpostSubnetsPrameter?: StringListParameter;

  /**
   * The parameter created if publicAlbArns were provided.
   */
  readonly publicAlbsParameter?: StringListParameter;

  /**
   * The parameter created if privateAlbArns were provided.
   */
  readonly privateAlbsParameter?: StringListParameter;

  /**
   * The parameter created if publicAlbCertificateArns were provided.
   */
  readonly publicAlbCertificatesParameter?: StringListParameter;

  /**
   * The parameter created if privateAlbCertificateArns were provided.
   */
  readonly privateAlbCertificatesParameter?: StringListParameter;

  /**
   * The parameter created if altPublicAlbArns were provided.
   */
  readonly altPublicAlbsParameter?: StringListParameter;

  /**
   * The parameter created if altPrivateAlbArns were provided.
   */
  readonly altPrivateAlbsParameter?: StringListParameter;

  /**
   * The parameter created if altPublicAlbCertificateArns were provided.
   */
  readonly altPublicAlbCertificatesParameter?: StringListParameter;

  /**
   * The parameter created if altPrivateAlbCertificateArns were provided.
   */
  readonly altPrivateAlbCertificatesParameter?: StringListParameter;

  /**
   * The parameter created if publicCertificateArn was provided.
   */
  readonly publicCertificateParameter?: StringParameter;

  /**
   * The parameter created if privateCertificateArn was provided.
   */
  readonly privateCertificateParameter?: StringParameter;

  /**
   * The parameter created if cloudFrontCertificateArn was provided.
   */
  readonly cloudFrontCertificateParameter?: StringParameter;

  /**
   * The parameter created if publicZoneName was provided.
   */
  readonly publicZoneParameter?: StringParameter;

  /**
   * The parameter created if privateZoneName was provided.
   */
  readonly privateZoneParameter?: StringParameter;

  /**
   * The vpcId if provided or lookups are enabled.
   */
  readonly vpcId?: string;

  /**
   * The availability zones if provided or lookups are enabled.
   */
  readonly azs?: string[];

  /**
   * The public subnet IDs if provided or lookups are enabled.
   */
  readonly publicSubnetIds?: string[];

  /**
   * The private subnet IDs if provided or lookups are enabled.
   */
  readonly privateSubnetIds?: string[];

  /**
   * The intra subnet IDs if provided or lookups are enabled.
   */
  readonly intraSubnetIds?: string[];

  /**
   * The redshift subnet IDs if provided or lookups are enabled.
   */
  readonly redshiftSubnetIds?: string[];

  /**
   * The database subnet IDs if provided or lookups are enabled.
   */
  readonly databaseSubnetIds?: string[];

  /**
   * The elasticache subnet IDs if provided or lookups are enabled.
   */
  readonly elasticacheSubnetIds?: string[];

  /**
   * The outpost subnet IDs if provided or lookups are enabled.
   */
  readonly outpostSubnetIds?: string[];

  /**
   * The public ALB ARNs if provided or lookups are enabled.
   */
  readonly publicAlbArns?: string[];

  /**
   * The private ALB ARNs if provided or lookups are enabled.
   */
  readonly privateAlbArns?: string[];

  /**
   * The certificate ARNs on the public ALBs if provided or lookups are enabled.
   */
  readonly publicAlbCertificateArns?: string[];

  /**
   * The certificate ARNs on the private ALbs if provided or lookups are enabled.
   */
  readonly privateAlbCertificateArns?: string[];

  /**
   * The alternative public ALB ARNs if provided or lookups are enabled.
   */
  readonly altPublicAlbArns?: string[];

  /**
   * The alternative private ALB ARNs if provided or lookups are enabled.
   */
  readonly altPrivateAlbArns?: string[];

  /**
   * The certificate ARNs on the alternative public ALBs if provided or lookups are enabled.
   */
  readonly altPublicAlbCertificateArns?: string[];

  /**
   * The certificate ARNs on the alternative private ALbs if provided or lookups are enabled.
   */
  readonly altPrivateAlbCertificateArns?: string[];

  /**
   * The public certificate ARN if provided or lookups are enabled.
   */
  readonly publicCertificateArn?: string;

  /**
   * The private certificate ARN if provided or lookups are enabled.
   */
  readonly privateCertificateArn?: string;

  /**
   * The CloudFront certificate ARN if provided or lookups are enabled.
   */
  readonly cloudFrontCertificateArn?: string;

  /**
   * The public zone name if provided or lookups are enabled.
   */
  readonly publicZoneName?: string;

  /**
   * The private zone name if provided or lookups are enabled.
   */
  readonly privateZoneName?: string;

  /**
   * Creates a new NetworkParameters instance.
   *
   * @param scope the parent scope
   * @param id the id of the instance
   * @param props properties for the instance
   */
  constructor(scope: Construct, id: string, props: NetworkParametersProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });
    const create = props.create ?? true;
    const prefix = props.prefix ?? '/network';
    const path = `${prefix}/${props.name}`;
    this.vpcParameterPath = `${path}/vpc`;
    this.azsParameterPath = `${path}/azs`;
    this.publicSubnetsParameterPath = `${path}/public_subnets`;
    this.privateSubnetsParameterPath = `${path}/private_subnets`;
    this.intraSubnetsParameterPath = `${path}/intra_subnets`;
    this.redshiftSubnetsParameterPath = `${path}/redshift_subnets`;
    this.databaseSubnetsParameterPath = `${path}/database_subnets`;
    this.elasticacheSubnetsParameterPath = `${path}/elasticache_subnets`;
    this.outpostSubnetsParameterPath = `${path}/outpost_subnets`;
    this.publicAlbsParameterPath = `${path}/public_albs`;
    this.privateAlbsParameterPath = `${path}/private_albs`;
    this.publicAlbCertificatesParameterPath = `${path}/public_alb_certificates`;
    this.privateAlbCertificatesParameterPath = `${path}/private_alb_certificates`;
    this.altPublicAlbsParameterPath = `${path}/alt_public_albs`;
    this.altPrivateAlbsParameterPath = `${path}/alt_private_albs`;
    this.altPublicAlbCertificatesParameterPath = `${path}/alt_public_alb_certificates`;
    this.altPrivateAlbCertificatesParameterPath = `${path}/alt_private_alb_certificates`;
    this.publicCertificateParameterPath = `${path}/public_certificate`;
    this.privateCertificateParameterPath = `${path}/private_certificate`;
    this.cloudFrontCertificateParameterPath = `${path}/cloudfront_certificate`;
    this.publicZoneParameterPath = `${path}/public_zone`;
    this.privateZoneParameterPath = `${path}/private_zone`;

    if (create) {
      if (props.vpcId) {
        this.vpcParameter = new StringParameter(this, 'VpcId', {
          parameterName: this.vpcParameterPath,
          stringValue: props.vpcId,
        });
        this.vpcId = props.vpcId;
      }
      if (props.azs) {
        this.azsParameter = new StringListParameter(this, 'AZs', {
          parameterName: this.azsParameterPath,
          stringListValue: props.azs,
        });
        this.azs = props.azs;
      }
      if (props.publicSubnetIds) {
        this.publicSubnetsParameter = new StringListParameter(
          this,
          'PublicSubnets',
          {
            parameterName: this.publicSubnetsParameterPath,
            stringListValue: props.publicSubnetIds,
          },
        );
        this.publicSubnetIds = props.privateSubnetIds;
      }
      if (props.privateSubnetIds) {
        this.privateSubnetsParameter = new StringListParameter(
          this,
          'PrivateSubnets',
          {
            parameterName: this.privateSubnetsParameterPath,
            stringListValue: props.privateSubnetIds,
          },
        );
        this.privateSubnetIds = props.privateSubnetIds;
      }
      if (props.intraSubnetIds) {
        this.intraSubnetsParameter = new StringListParameter(
          this,
          'IntraSubnets',
          {
            parameterName: this.intraSubnetsParameterPath,
            stringListValue: props.intraSubnetIds,
          },
        );
        this.intraSubnetIds = props.intraSubnetIds;
      }
      if (props.redshiftSubnetIds) {
        this.redshiftSubnetsParameter = new StringListParameter(
          this,
          'RedshiftSubnets',
          {
            parameterName: this.redshiftSubnetsParameterPath,
            stringListValue: props.redshiftSubnetIds,
          },
        );
        this.redshiftSubnetIds = props.redshiftSubnetIds;
      }
      if (props.databaseSubnetIds) {
        this.databaseSubnetsParameter = new StringListParameter(
          this,
          'DatabaseSubnets',
          {
            parameterName: this.databaseSubnetsParameterPath,
            stringListValue: props.databaseSubnetIds,
          },
        );
        this.databaseSubnetIds = props.databaseSubnetIds;
      }
      if (props.elasticacheSubnetIds) {
        this.elasticacheSubnetsParameter = new StringListParameter(
          this,
          'ElasticacheSubnets',
          {
            parameterName: this.elasticacheSubnetsParameterPath,
            stringListValue: props.elasticacheSubnetIds,
          },
        );
        this.elasticacheSubnetIds = props.elasticacheSubnetIds;
      }
      if (props.outpostSubnetIds) {
        this.outpostSubnetsPrameter = new StringListParameter(
          this,
          'OutpostSubnets',
          {
            parameterName: this.outpostSubnetsParameterPath,
            stringListValue: props.outpostSubnetIds,
          },
        );
        this.outpostSubnetIds = props.outpostSubnetIds;
      }
      if (props.publicAlbArns) {
        this.publicAlbsParameter = new StringListParameter(this, 'PublicAlbs', {
          parameterName: this.publicAlbsParameterPath,
          stringListValue: props.publicAlbArns,
        });
        this.publicAlbArns = props.publicAlbArns;
      }
      if (props.privateAlbArns) {
        this.privateAlbsParameter = new StringListParameter(
          this,
          'PrivateAlbs',
          {
            parameterName: this.privateAlbsParameterPath,
            stringListValue: props.privateAlbArns,
          },
        );
        this.privateAlbArns = props.privateAlbArns;
      }
      if (props.publicAlbCertificateArns) {
        this.publicAlbCertificatesParameter = new StringListParameter(
          this,
          'PublicAlbCertificates',
          {
            parameterName: this.publicAlbCertificatesParameterPath,
            stringListValue: props.publicAlbCertificateArns,
          },
        );
      }
      if (props.privateAlbCertificateArns) {
        this.privateAlbCertificatesParameter = new StringListParameter(
          this,
          'PrivateAlbCertificates',
          {
            parameterName: this.privateAlbCertificatesParameterPath,
            stringListValue: props.privateAlbCertificateArns,
          },
        );
      }
      if (props.altPublicAlbArns) {
        this.altPublicAlbsParameter = new StringListParameter(
          this,
          'AltPublicAlbs',
          {
            parameterName: this.altPublicAlbsParameterPath,
            stringListValue: props.altPublicAlbArns,
          },
        );
      }
      if (props.altPrivateAlbArns) {
        this.altPrivateAlbsParameter = new StringListParameter(
          this,
          'AltPrivateAlbs',
          {
            parameterName: this.altPrivateAlbsParameterPath,
            stringListValue: props.altPrivateAlbArns,
          },
        );
      }
      if (props.altPublicAlbCertificateArns) {
        this.altPublicAlbCertificatesParameter = new StringListParameter(
          this,
          'AltPublicAlbCertificates',
          {
            parameterName: this.altPublicAlbCertificatesParameterPath,
            stringListValue: props.altPublicAlbCertificateArns,
          },
        );
      }
      if (props.altPrivateAlbCertificateArns) {
        this.altPrivateAlbCertificatesParameter = new StringListParameter(
          this,
          'AltPrivateAlbCertificates',
          {
            parameterName: this.altPrivateAlbCertificatesParameterPath,
            stringListValue: props.altPrivateAlbCertificateArns,
          },
        );
      }
      if (props.publicCertificateArn) {
        this.publicCertificateParameter = new StringParameter(
          this,
          'PublicCertificate',
          {
            parameterName: this.publicCertificateParameterPath,
            stringValue: props.publicCertificateArn,
          },
        );
      }
      if (props.privateCertificateArn) {
        this.privateCertificateParameter = new StringParameter(
          this,
          'PrivateCertificate',
          {
            parameterName: this.privateCertificateParameterPath,
            stringValue: props.privateCertificateArn,
          },
        );
      }
      if (props.cloudFontCertificateArn) {
        this.cloudFrontCertificateParameter = new StringParameter(
          this,
          'CloudFrontCertificate',
          {
            parameterName: this.cloudFrontCertificateParameterPath,
            stringValue: props.cloudFontCertificateArn,
          },
        );
      }
      if (props.publicZoneName) {
        this.publicZoneParameter = new StringParameter(this, 'PublicZone', {
          parameterName: this.publicZoneParameterPath,
          stringValue: props.publicZoneName,
        });
      }
      if (props.privateZoneName) {
        this.privateZoneParameter = new StringParameter(this, 'PrivateZone', {
          parameterName: this.privateZoneParameterPath,
          stringValue: props.privateZoneName,
        });
      }
    }
    if (props.lookupVpc ?? true) {
      if (!this.vpcId) {
        this.vpcId = StringParameter.valueFromLookup(
          this,
          this.vpcParameterPath,
        );
      }
    }
    if (props.lookupAzs ?? true) {
      if (!this.azs) {
        this.azs = StringParameter.valueFromLookup(
          this,
          this.azsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPublicSubnets ?? true) {
      if (!this.publicSubnetIds) {
        this.publicSubnetIds = StringParameter.valueFromLookup(
          this,
          this.publicSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPrivateSubnets ?? true) {
      if (!this.privateSubnetIds) {
        this.privateSubnetIds = StringParameter.valueFromLookup(
          this,
          this.privateSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupIntraSubnets ?? false) {
      if (!this.intraSubnetIds) {
        this.intraSubnetIds = StringParameter.valueFromLookup(
          this,
          this.intraSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupRedshiftSubnets ?? false) {
      if (!this.redshiftSubnetIds) {
        this.redshiftSubnetIds = StringParameter.valueFromLookup(
          this,
          this.redshiftSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupDatabaseSubnets ?? false) {
      if (!this.databaseSubnetIds) {
        this.databaseSubnetIds = StringParameter.valueFromLookup(
          this,
          this.databaseSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupElasticacheSubnets ?? false) {
      if (!this.elasticacheSubnetIds) {
        this.elasticacheSubnetIds = StringParameter.valueFromLookup(
          this,
          this.elasticacheSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupOutpostSubnets ?? false) {
      if (!this.outpostSubnetIds) {
        this.outpostSubnetIds = StringParameter.valueFromLookup(
          this,
          this.outpostSubnetsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPublicAlbs ?? false) {
      if (!this.publicAlbArns) {
        this.publicAlbArns = StringParameter.valueFromLookup(
          this,
          this.publicAlbsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPrivateAlbs ?? false) {
      if (!this.privateAlbArns) {
        this.privateAlbArns = StringParameter.valueFromLookup(
          this,
          this.privateAlbsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPublicAlbCertificates ?? false) {
      if (!this.publicAlbCertificateArns) {
        this.publicAlbCertificateArns = StringParameter.valueFromLookup(
          this,
          this.publicAlbCertificatesParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPrivateAlbCertificates ?? false) {
      if (!this.privateAlbCertificateArns) {
        this.privateAlbCertificateArns = StringParameter.valueFromLookup(
          this,
          this.privateAlbCertificatesParameterPath,
        ).split(',');
      }
    }
    if (props.lookupAltPublicAlbs ?? false) {
      if (!this.altPublicAlbArns) {
        this.altPublicAlbArns = StringParameter.valueFromLookup(
          this,
          this.altPublicAlbsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupAltPrivateAlbs ?? false) {
      if (!this.altPrivateAlbArns) {
        this.altPrivateAlbArns = StringParameter.valueFromLookup(
          this,
          this.altPrivateAlbsParameterPath,
        ).split(',');
      }
    }
    if (props.lookupAltPublicAlbCertificates ?? false) {
      if (!this.altPublicAlbCertificateArns) {
        this.altPublicAlbCertificateArns = StringParameter.valueFromLookup(
          this,
          this.altPublicAlbCertificatesParameterPath,
        ).split(',');
      }
    }
    if (props.lookupAltPrivateAlbCertificates ?? false) {
      if (!this.altPrivateAlbCertificateArns) {
        this.altPrivateAlbCertificateArns = StringParameter.valueFromLookup(
          this,
          this.altPrivateAlbCertificatesParameterPath,
        ).split(',');
      }
    }
    if (props.lookupPublicCertificate ?? false) {
      if (!this.publicCertificateArn) {
        this.publicCertificateArn = StringParameter.valueFromLookup(
          this,
          this.publicCertificateParameterPath,
        );
      }
    }
    if (props.lookupPrivateCertificate ?? false) {
      if (!this.privateCertificateArn) {
        this.privateCertificateArn = StringParameter.valueFromLookup(
          this,
          this.privateCertificateParameterPath,
        );
      }
    }
    if (props.lookupCloudFrontCertificate ?? false) {
      if (!this.cloudFrontCertificateArn) {
        this.cloudFrontCertificateArn = StringParameter.valueFromLookup(
          this,
          this.cloudFrontCertificateParameterPath,
        );
      }
    }
    if (props.lookupPublicZone ?? false) {
      if (!this.publicZoneName) {
        this.publicZoneName = StringParameter.valueFromLookup(
          this,
          this.publicZoneParameterPath,
        );
      }
    }
    if (props.lookupPrivateZone ?? false) {
      if (!this.privateZoneName) {
        this.privateZoneName = StringParameter.valueFromLookup(
          this,
          this.privateZoneParameterPath,
        );
      }
    }
  }
}
