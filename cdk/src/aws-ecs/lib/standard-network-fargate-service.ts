import {
  StandardFargateService,
  StandardFargateServiceProps,
} from './standard-fargate-service';
import {Construct} from 'constructs';
import {
  INetworkListener,
  INetworkLoadBalancer,
  NetworkListener,
  NetworkLoadBalancer,
  NetworkTargetGroup,
  Protocol,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {Duration} from 'aws-cdk-lib';
import {ARecord, IHostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {DomainName} from '../../aws-route53/index';
import {LoadBalancerTarget} from 'aws-cdk-lib/aws-route53-targets';

/**
 * Properties for StandardNetworkFargateService.
 */
export interface StandardNetworkFargateServiceProps extends StandardFargateServiceProps {
  /**
   * Indicates whether the load balancer terminates connections at the end of the deregistration timeout.
   *
   * @default - false
   */
  readonly connectionTermination?: boolean;

  /**
   * The amount of time for Elastic Load Balancing to wait before deregistering a target.
   * The range is 0-3600 seconds
   *
   * @default - Duration.seconds(10)
   */
  readonly deregistrationDelay?: Duration;

  /**
   * Indicates whether health checks are enabled.
   *
   * @default - true
   */
  readonly healthCheckEnabled?: boolean;

  /**
   * The number of consecutive health checks successes required before considering an unhealthy target healthy.
   *
   * @default - 2
   */
  readonly healthyThresholdCount?: number;

  /**
   * The approximate number of seconds between health checks for an individual target.
   *
   * @default - Duration.seconds(10)
   */
  readonly healthCheckInterval?: Duration;

  /**
   * The protocol the load balancer uses when performing health checks on targets.
   *
   * @default - networkProtocol
   */
  readonly healthCheckProtocol?: Protocol;

  /**
   * The period of time, in seconds, that the Amazon ECS service scheduler ignores unhealthy
   * Elastic Load Balancing target health checks after a task has first started.
   *
   * @default - defaults to 60 seconds if at least one load balancer is in-use and it is not already set
   */
  readonly healthCheckGracePeriod?: Duration;

  /**
   * The amount of time, in seconds, during which no response from a target means a failed health check.
   *
   * @default - Duration.seconds(3)
   */
  readonly healthCheckTimeout?: Duration;

  /**
   * The number of consecutive health check failures required before considering a target unhealthy.
   *
   * @default - 2
   */
  readonly unhealthyThresholdCount?: number;

  /**
   * Protocol for target group, expects TCP, TLS, UDP, or TCP_UDP
   *
   * @default Protocol.TCP
   */
  readonly networkProtocol?: Protocol;

  /**
   * Indicates whether Proxy Protocol version 2 is enabled.
   *
   * @default - false
   */
  readonly proxyProtocolV2?: boolean;

  /**
   * Load balancer to attach this service to. If passed an ARN or name a lookup will be
   * performed to locate the load balancer.
   */
  readonly loadBalancer: INetworkLoadBalancer | string;

  /**
   * Listener port on the load balancer to map this service to.
   */
  readonly listenerPort: number;

  /**
   * Domain name prefix associated with this service.
   *
   * @default - ""
   */
  readonly domainPrefix?: string;

  /**
   * Zone of the domain name. If set, a route53 record is created for the service.
   */
  readonly domainZone?: IHostedZone;
}

/**
 * Creates an ECS Fargate service and maps it to a Network Load Balancer (NLB).
 */
export class StandardNetworkFargateService extends StandardFargateService {
  readonly loadBalancer: INetworkLoadBalancer;
  readonly listener: INetworkListener;
  readonly domainName?: DomainName;
  readonly route53Record?: ARecord;

  constructor(
    scope: Construct,
    id: string,
    props: StandardNetworkFargateServiceProps,
  ) {
    super(scope, id, props);

    const targetGroup = new NetworkTargetGroup(this, 'TargetGroup', {
      targets: [this.service],
      vpc: props.cluster.vpc,
      port: this.port,
      connectionTermination: props.connectionTermination ?? false,
      deregistrationDelay: props.deregistrationDelay ?? Duration.seconds(10),
      healthCheck: {
        enabled: props.healthCheckEnabled ?? true,
        healthyThresholdCount: props.healthyThresholdCount ?? 2,
        interval: props.healthCheckInterval ?? Duration.seconds(10),
        protocol: props.healthCheckProtocol ?? Protocol.TCP,
        timeout: props.healthCheckTimeout ?? Duration.seconds(3),
        unhealthyThresholdCount: props.unhealthyThresholdCount ?? 2,
      },
      protocol: props.networkProtocol ?? Protocol.TCP,
      proxyProtocolV2: props.proxyProtocolV2 ?? false,
    });

    let loadBalancer: INetworkLoadBalancer;
    if (typeof props.loadBalancer === 'string') {
      if (props.loadBalancer.startsWith('arn:')) {
        loadBalancer = NetworkLoadBalancer.fromLookup(this, 'LoadBalancer', {
          loadBalancerArn: props.loadBalancer,
        });
      } else {
        loadBalancer = NetworkLoadBalancer.fromLookup(this, 'LoadBalancer', {
          loadBalancerTags: {
            Name: props.loadBalancer,
          },
        });
      }
    } else {
      loadBalancer = props.loadBalancer;
    }

    const listener = NetworkListener.fromLookup(this, 'Listener', {
      loadBalancerArn: loadBalancer.loadBalancerArn,
      listenerPort: props.listenerPort,
    });

    targetGroup.registerListener(listener);

    if (props.domainZone !== undefined) {
      this.domainName = new DomainName({
        prefix: props.domainPrefix ?? '',
        zone: props.domainZone,
      });
      this.route53Record = this.domainName.createARecord(
        this,
        RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
      );
    }
    this.loadBalancer = loadBalancer;
    this.listener = listener;
  }
}
