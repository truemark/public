import {
  StandardFargateService,
  StandardFargateServiceProps,
} from './standard-fargate-service';
import {Construct} from 'constructs';
import {Duration} from 'aws-cdk-lib';
import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  IApplicationListener,
  IApplicationLoadBalancer,
  IApplicationTargetGroup,
  ListenerCondition,
  TargetGroupLoadBalancingAlgorithmType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {ARecord, IHostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {DomainName} from '../../aws-route53';
import {LoadBalancerTarget} from 'aws-cdk-lib/aws-route53-targets';
import {MetricOptions} from 'aws-cdk-lib/aws-cloudwatch';
import {PriorityAllocator} from './priority-allocator';

/**
 * Properties for StandardApplicationFargateService
 */
export interface StandardApplicationFargateServiceProps extends StandardFargateServiceProps {
  /**
   * The name of an application-based stickiness cookie.
   *
   * @default - lb_affinity
   */
  readonly stickinessCookieName?: string;

  /**
   * The stickiness cookie expiration period. Set to 0 to disable.
   *
   * @default - Duration.days(1)
   */
  readonly stickinessCookieDuration?: Duration;

  /**
   * The time period during which the load balancer sends a newly registered target a
   * linearly increasing share of the traffic to the target group. Set this to 0
   * to disable.
   *
   * @default - Duration.seconds(30)
   */
  readonly slowStart?: Duration;

  /**
   * The protocol used by the application in the container.
   *
   * @default - ApplicationProtocol.HTTP
   */
  readonly applicationProtocol?: ApplicationProtocol;

  /**
   * The amount of time for Elastic Load Balancing to wait before deregistering a target.
   *
   * @default - Duration.seconds(10)
   */
  readonly deregistrationDelay?: Duration;

  /**
   * The approximate number of seconds between health checks for an individual target.
   *
   * @default - Duration.seconds(10)
   */
  readonly healthCheckInterval?: Duration;

  /**
   * The period of time, in seconds, that the Amazon ECS service scheduler ignores unhealthy
   * Elastic Load Balancing target health checks after a task has first started.
   *
   * @default - defaults to 60 seconds
   */
  readonly healthCheckGracePeriod?: Duration;

  /**
   * The ping path destination where Elastic Load Balancing sends health check requests.
   *
   * @default - /health
   */
  readonly healthCheckPath?: string;

  /**
   * The amount of time, in seconds, during which no response from a target means a failed health check
   *
   * @default - Duration.seconds(3)
   */
  readonly healthCheckTimeout?: Duration;

  /**
   * The number of consecutive health checks successes required before considering an unhealthy target healthy.
   *
   * @default - 2
   */
  readonly healthyThresholdCount?: number;

  /**
   * The number of consecutive health check failures required before considering a target unhealthy.
   *
   * @default - 2
   */
  readonly unhealthyThresholdCount?: number;

  /**
   * HTTP code to use when checking for a successful response from a target
   *
   * @default - 200-299
   */
  readonly healthyHttpCodes?: string;

  /**
   * The load balancing algorithm to select targets for routing requests.
   * To set this to LEAST_OUTSTANDING_REQUESTS, stickiness must be disabled.
   *
   * @default - ROUND_ROBIN
   */
  readonly loadBalancingAlgorithmType?: TargetGroupLoadBalancingAlgorithmType;

  /**
   * The number of ALB requests to target for scaling.
   * Disabled by default.
   */
  readonly scaleRequestPerTarget?: number;

  /**
   * Target response time for scaling
   * Disabled by default
   */
  readonly scaleOnTargetResponseTime?: {
    /** Threshold in seconds */
    threshold: number;
    metricOptions?: MetricOptions;
  };

  /**
   * Domain name associated with this service.
   */
  readonly domainName?: string;

  /**
   * Additional domain names to associate with this service.
   */
  readonly domainNames?: string[];

  /**
   * Set this to true to skip the creation of route53 records. By default records will be created in domainName and domainZone is provided.
   *
   * @default - false
   */
  readonly skipCreateRoute53Records?: boolean;

  /**
   * Path pattern to match on the load balancer.
   *
   * @default - ["/*"]
   */
  readonly pathPattern?: string[];

  /**
   * Load balancer to attach this service to. If passed an ARN or name a lookup will be
   * performed to locate the load balancer.
   */
  readonly loadBalancer: IApplicationLoadBalancer | string;

  /**
   * The listener to attach this service to. If one is not provided an HTTPS listener is obtained from a lookup.
   *
   * @default - ApplicationProtocol.HTTPS
   */
  readonly listener?: IApplicationListener;

  /**
   * The priority to give the target group on the ALB.
   * If not specified, a unique priority is automatically allocated using
   * the PriorityAllocator, which coordinates with other services across
   * multiple teams and tools (CDK, Terraform, manual) to find the lowest
   * available priority.
   *
   * @default - Automatically allocated (recommended for most use cases)
   */
  readonly targetGroupPriority?: number;

  /**
   * Zone of the domain name. If set, a route53 record is created for the service.
   *
   */
  readonly domainZone?: IHostedZone;
}

/**
 * Creates an ECS Fargate service and maps it to an Application Load Balancer (ALB).
 */
export class StandardApplicationFargateService extends StandardFargateService {
  readonly loadBalancer: IApplicationLoadBalancer;
  readonly listener: IApplicationListener;
  readonly domainName?: DomainName;
  readonly route53Record?: ARecord;
  readonly targetGroup: IApplicationTargetGroup;

  constructor(
    scope: Construct,
    id: string,
    props: StandardApplicationFargateServiceProps,
  ) {
    super(scope, id, {
      ...props,
      healthCheckGracePeriod:
        props.healthCheckGracePeriod ?? Duration.seconds(60),
    });

    let stickinessCookieDuration: Duration | undefined =
      props.stickinessCookieDuration ?? Duration.days(1);
    if (stickinessCookieDuration.toSeconds() === 0) {
      stickinessCookieDuration = undefined;
    }

    let stickinessCookieName: string | undefined;
    if (stickinessCookieDuration !== undefined) {
      stickinessCookieName = props.stickinessCookieName ?? 'lb_affinity';
    }

    let slowStart: Duration | undefined =
      props.slowStart ?? Duration.seconds(30);
    if (slowStart.toSeconds() === 0) {
      slowStart = undefined;
    }

    const targetGroup = new ApplicationTargetGroup(this, 'TargetGroup', {
      targets: [this.service],
      vpc: props.cluster.vpc,
      port: this.port,
      protocol: props.applicationProtocol ?? ApplicationProtocol.HTTP,
      deregistrationDelay: props.deregistrationDelay ?? Duration.seconds(10),
      slowStart,
      healthCheck: {
        enabled: true,
        interval: props.healthCheckInterval ?? Duration.seconds(10),
        path: props.healthCheckPath ?? '/health',
        timeout: props.healthCheckTimeout ?? Duration.seconds(3),
        healthyThresholdCount: props.healthyThresholdCount ?? 2,
        unhealthyThresholdCount: props.unhealthyThresholdCount ?? 2,
        healthyHttpCodes: props.healthyHttpCodes ?? '200-299',
      },
      stickinessCookieName,
      stickinessCookieDuration,
      loadBalancingAlgorithmType:
        props.loadBalancingAlgorithmType ??
        TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
    });

    if (props.scaleRequestPerTarget !== undefined) {
      this.scaling.scaleOnRequestCount('RequestCountScaling', {
        scaleInCooldown: this.scaleInCooldown,
        scaleOutCooldown: this.scaleOutCooldown,
        targetGroup,
        requestsPerTarget: props.scaleRequestPerTarget,
      });
    }

    const targetGroupConditions: ListenerCondition[] = [];
    targetGroupConditions.push(
      ListenerCondition.pathPatterns(props.pathPattern ?? ['/*']),
    );
    if (props.domainName !== undefined) {
      targetGroupConditions.push(
        ListenerCondition.hostHeaders([
          props.domainName,
          ...(props.domainNames ?? []),
        ]),
      );
    }

    let loadBalancer: IApplicationLoadBalancer;
    if (typeof props.loadBalancer === 'string') {
      if (props.loadBalancer.startsWith('arn:')) {
        loadBalancer = ApplicationLoadBalancer.fromLookup(
          this,
          'LoadBalancer',
          {
            loadBalancerArn: props.loadBalancer,
          },
        );
      } else {
        loadBalancer = ApplicationLoadBalancer.fromLookup(
          this,
          'LoadBalancer',
          {
            loadBalancerTags: {
              Name: props.loadBalancer,
            },
          },
        );
      }
    } else {
      loadBalancer = props.loadBalancer;
    }

    const listener =
      props.listener ??
      ApplicationListener.fromLookup(this, 'Listener', {
        loadBalancerArn: loadBalancer.loadBalancerArn,
        listenerProtocol: ApplicationProtocol.HTTPS,
      });

    // Determine priority: use explicit value, or allocate automatically
    let priority: number;
    if (props.targetGroupPriority !== undefined) {
      // Manual priority specified - use it directly
      priority = props.targetGroupPriority;
    } else {
      // No priority specified - use automatic allocation
      const allocator = new PriorityAllocator(this, 'PriorityAllocator', {
        listenerArn: listener.listenerArn,
      });
      priority = allocator.priority;
    }

    listener.addTargetGroups(`${id}TargetGroups`, {
      targetGroups: [targetGroup],
      conditions: targetGroupConditions,
      priority,
    });

    if (
      props.domainName !== undefined &&
      props.domainZone !== undefined &&
      !props.skipCreateRoute53Records
    ) {
      this.domainName = DomainName.fromFqdn(props.domainName, props.domainZone);
      this.route53Record = this.domainName.createARecord(
        this,
        RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
      );
    }

    this.loadBalancer = loadBalancer;
    this.listener = listener;
    this.targetGroup = targetGroup;

    if (props.scaleOnTargetResponseTime) {
      // Attach scaling policy to the service
      this.scaleToTrackCustomMetric(
        'TargetResponseTimeScaling',
        targetGroup.metrics.targetResponseTime(
          props.scaleOnTargetResponseTime.metricOptions,
        ),
        props.scaleOnTargetResponseTime.threshold,
      );
    }
  }
}
