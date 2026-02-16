import {Construct} from 'constructs';
import {StandardDomainName} from './standard-domain-name';
import {
  SecurityPolicy,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import {ARecord} from 'aws-cdk-lib/aws-route53';
import {LatencyARecord, WeightedARecord} from '../../aws-route53';
import {Stack, Stage} from 'aws-cdk-lib';
import {ExtendedConstruct, ExtendedConstructProps} from '../../aws-cdk';

/**
 * Properties for StandardWebSocketApi.
 */
export interface StandardWebSocketApiProps extends ExtendedConstructProps {
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
}

/**
 * Abstraction that creates an WebSocketApi with support infrastructure.
 */
export class StandardWebSocketApi extends ExtendedConstruct {
  readonly domainName?: StandardDomainName;
  readonly record: ARecord | LatencyARecord | WeightedARecord | undefined;
  readonly webSocketApi: WebSocketApi;
  readonly webSocketStage: WebSocketStage;

  constructor(scope: Construct, id: string, props: StandardWebSocketApiProps) {
    super(scope, id);

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

    const webSocketApi = new WebSocketApi(this, 'Default', {
      apiName: props.apiName ?? `${stage?.stageName}${stack?.stackName}Gateway`,
    });

    const webSocketStage = new WebSocketStage(this, 'DefaultStage', {
      webSocketApi,
      stageName: 'default',
      autoDeploy: true,
      domainMapping: {
        domainName: domainName.gatewayDomainName,
      },
    });

    this.webSocketApi = webSocketApi;
    this.webSocketStage = webSocketStage;
  }
}
