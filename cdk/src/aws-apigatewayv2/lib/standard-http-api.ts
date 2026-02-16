import {Construct} from 'constructs';
import {LatencyARecord, WeightedARecord} from '../../aws-route53';
import {StandardDomainName} from './standard-domain-name';
import {
  CorsPreflightOptions,
  HttpApi,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import {Stack, Stage} from 'aws-cdk-lib';
import {ARecord} from 'aws-cdk-lib/aws-route53';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';
import {IHttpRouteAuthorizer} from 'aws-cdk-lib/aws-apigatewayv2';

/**
 * Properties for StandardHttpApi.
 */
export interface StandardHttpApiProps extends ExtendedConstructProps {
  /**
   * The prefix of the domain to create the certificate and DNS record for.
   */
  readonly domainPrefix: string;

  /**
   * The zone of the domain to create the certificate and DNS record for.
   */
  readonly domainZone: string;

  /**
   * Name of the API Gateway. One will be generated if not provided.
   */
  readonly apiName?: string;

  /**
   * Determines if a route53 record is created for the API gateway. Defaults to true.
   *
   * @default - true
   */
  readonly createRecord?: boolean;

  /**
   * Creates a weighted route53 record. May not be used with recordLatency.
   */
  readonly recordWeight?: number;

  /**
   * Creates a latency route53 record. May not be used with recordWeight.
   */
  readonly recordLatency?: boolean;

  /**
   * Evaluates target health on the created route53 record if it's a latency or weighted record. Defaults to true.
   *
   * @default - true
   */
  readonly evaluateTargetHealth?: boolean;

  /**
   * Setting this to true will suppress the creation of default tags on resources
   * created by this construct. Default is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;

  /**
   * The CORS configuration to apply to this API.
   */
  readonly corsPreflight?: CorsPreflightOptions;

  /**
   * Default Authorizer to applied to all routes in the gateway.
   */
  readonly defaultAuthorizer?: IHttpRouteAuthorizer;

  /**
   * Default OIDC scopes attached to all routes in the gateway, unless explicitly configured on the route.
   */
  readonly defaultAuthorizationScopes?: string[];
}

/**
 * Abstraction that creates an HttpApi with support infrastructure.
 */
export class StandardHttpApi extends ExtendedConstruct {
  readonly domainName: StandardDomainName;
  readonly record: ARecord | LatencyARecord | WeightedARecord | undefined;
  readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: StandardHttpApiProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const domainName = new StandardDomainName(this, 'DomainName', {
      prefix: props.domainPrefix,
      zone: props.domainZone,
      securityPolicy: SecurityPolicy.TLS_1_2, // TODO Should be an option
    });

    // TODO Need to add RecordOptions
    if (props.createRecord ?? true) {
      if (props.recordWeight) {
        domainName.createWeightedARecord(
          props.recordWeight,
          props.evaluateTargetHealth ?? true,
        );
      } else if (props.recordLatency) {
        domainName.createLatencyARecord(true);
      } else {
        domainName.createARecord();
      }
    } else {
      this.record = undefined;
    }

    const stage = Stage.of(this);
    const stack = Stack.of(this);

    const httpApi = new HttpApi(this, 'Default', {
      apiName: props.apiName ?? `${stage?.stageName}${stack?.stackName}Gateway`,
      defaultDomainMapping: {
        domainName: domainName.gatewayDomainName,
      },
      corsPreflight: props.corsPreflight,
      defaultAuthorizer: props.defaultAuthorizer,
      defaultAuthorizationScopes: props.defaultAuthorizationScopes,
    });

    this.domainName = domainName;
    this.httpApi = httpApi;
  }
}
