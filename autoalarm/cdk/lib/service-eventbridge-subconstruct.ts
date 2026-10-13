import {Construct} from 'constructs';
import {EventPattern, Rule} from 'aws-cdk-lib/aws-events';
import {SqsQueue} from 'aws-cdk-lib/aws-events-targets';
import {IQueue} from 'aws-cdk-lib/aws-sqs';
import {NoBreachingExtendedQueue} from './extended-libs-subconstruct';
import {SERVICE_TAG_KEYS} from './service-tag-keys';

export type ServiceName =
  | 'alb'
  | 'cloudfront'
  | 'ec2'
  | 'ecs'
  | 'lambda'
  | 'logs'
  | 'opensearch'
  | 'rds'
  | 'rdscluster'
  | 'route53resolver'
  | 'sqs'
  | 'sfn'
  | 'targetgroup'
  | 'transitgateway'
  | 'vpn';

interface ServiceRuleDescriptor {
  /**
   * CDK construct id for the rule. Preserved verbatim from the original
   * per-service add*Rules methods so logical IDs (and therefore the deployed
   * rules) do not churn.
   */
  readonly id: string;
  readonly description: string;
  readonly eventPattern: EventPattern;
}

export interface ServiceDescriptor {
  readonly serviceName: ServiceName;
  /** Key into SqsHandlerSubConstruct.eventSourceQueues for this service. */
  readonly queueKey: string;
  readonly rules: ServiceRuleDescriptor[];
}

/**
 * Builds an event pattern for resource-tagging events
 * ("Tag Change on Resource") filtered to the autoalarm tag keys the service
 * supports. The changed-tag-keys lists live in service-tag-keys.ts and are
 * kept in sync with handlers/src/alarm-configs by service-tag-keys.test.ts.
 */
function tagChangePattern(
  service: string,
  resourceType: string,
  changedTagKeys: string[],
): EventPattern {
  return {
    source: ['aws.tag'],
    detailType: ['Tag Change on Resource'],
    detail: {
      'service': [service],
      'resource-type': [resourceType],
      'changed-tag-keys': changedTagKeys,
    },
  };
}

/**
 * Builds an event pattern for CloudTrail-delivered API calls
 * ("AWS API Call via CloudTrail") for the given event source and names.
 */
function cloudTrailPattern(
  source: string,
  eventSource: string,
  eventNames: string[],
): EventPattern {
  return {
    source: [source],
    detailType: ['AWS API Call via CloudTrail'],
    detail: {
      eventSource: [eventSource],
      eventName: eventNames,
    },
  };
}

/**
 * Single source of truth for every service AutoAlarm routes EventBridge
 * events for: each entry pairs a service's rules with its SQS handler queue
 * by reference (queueKey), so a rule can never be wired to the wrong queue
 * by name matching.
 */
export const SERVICE_DESCRIPTORS: ServiceDescriptor[] = [
  {
    serviceName: 'alb',
    queueKey: 'AutoAlarm-Alb',
    rules: [
      {
        id: 'AlbTagRule',
        description: 'Routes ALB tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'elasticloadbalancing',
          'loadbalancer',
          SERVICE_TAG_KEYS.alb,
        ),
      },
      {
        id: 'AlbRule',
        description: 'Routes ALB events to AutoAlarm',
        eventPattern: cloudTrailPattern(
          'aws.elasticloadbalancing',
          'elasticloadbalancing.amazonaws.com',
          ['CreateLoadBalancer', 'DeleteLoadBalancer'],
        ),
      },
    ],
  },
  {
    serviceName: 'cloudfront',
    queueKey: 'AutoAlarm-Cloudfront',
    rules: [
      {
        id: 'CloudStateRule',
        description: 'Routes CloudFront events to AutoAlarm',
        eventPattern: cloudTrailPattern(
          'aws.cloudfront',
          'cloudfront.amazonaws.com',
          ['CreateDistribution', 'DeleteDistribution'],
        ),
      },
      {
        id: 'CloudFrontTagRule',
        description: 'Routes CloudFront tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'cloudfront',
          'distribution',
          SERVICE_TAG_KEYS.cloudfront,
        ),
      },
    ],
  },
  {
    serviceName: 'ec2',
    queueKey: 'AutoAlarm-Ec2',
    rules: [
      {
        id: 'ec2TagRule',
        description: 'Routes tag events to AutoAlarm',
        eventPattern: tagChangePattern('ec2', 'instance', SERVICE_TAG_KEYS.ec2),
      },
      {
        id: 'Ec2StateRule',
        description: 'Routes ec2 instance events to AutoAlarm',
        eventPattern: {
          source: ['aws.ec2'],
          detailType: ['EC2 Instance State-change Notification'],
          detail: {
            state: ['running', 'terminated'],
          },
        },
      },
    ],
  },
  {
    serviceName: 'ecs',
    queueKey: 'AutoAlarm-Ecs',
    rules: [
      {
        id: 'EcsStateRule',
        description: 'Routes ECS state change and tag events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.ecs', 'ecs.amazonaws.com', [
          'DeleteService',
          'CreateService',
          'TagResource',
          'UntagResource',
        ]),
      },
    ],
  },
  {
    serviceName: 'lambda',
    queueKey: 'AutoAlarm-Lambda',
    rules: [
      {
        id: 'LambdaTagRule',
        description: 'Routes Lambda tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'lambda',
          'function',
          SERVICE_TAG_KEYS.lambda,
        ),
      },
      {
        id: 'LambdaStateRule',
        description: 'Routes Lambda function events to AutoAlarm',
        // Current Lambda management events carry a "...v2" suffix (verified
        // against a live us-west-2 CloudTrail record: TagResource20170331v2);
        // match both the legacy and v2 names so the rule fires regardless of
        // which the account emits.
        eventPattern: cloudTrailPattern('aws.lambda', 'lambda.amazonaws.com', [
          'CreateFunction20150331',
          'CreateFunction20150331v2',
          'DeleteFunction20150331',
          'DeleteFunction20150331v2',
        ]),
      },
    ],
  },
  {
    serviceName: 'logs',
    queueKey: 'AutoAlarm-Logs',
    rules: [
      {
        id: 'LogGroupStateRule',
        description:
          'Routes CloudWatch Logs create/delete/tag/untag events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.logs', 'logs.amazonaws.com', [
          'CreateLogGroup',
          'DeleteLogGroup',
          'TagResource',
          'UntagResource',
        ]),
      },
    ],
  },
  {
    serviceName: 'opensearch',
    queueKey: 'AutoAlarm-OpenSearchRule',
    rules: [
      {
        id: 'OpenSearchTagRule',
        description: 'Routes OpenSearch tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'es',
          'domain',
          SERVICE_TAG_KEYS.opensearch,
        ),
      },
      {
        id: 'OpenSearchStateRule',
        description: 'Routes OpenSearch events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.es', 'es.amazonaws.com', [
          'CreateDomain',
          'DeleteDomain',
        ]),
      },
    ],
  },
  {
    serviceName: 'rds',
    queueKey: 'AutoAlarm-Rds',
    rules: [
      {
        id: 'RDSTagRule',
        description: 'Routes RDS tag events to AutoAlarm',
        eventPattern: tagChangePattern('rds', 'db', SERVICE_TAG_KEYS.rds),
      },
      {
        id: 'RDSStateRule',
        description: 'Routes RDS events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.rds', 'rds.amazonaws.com', [
          'CreateDBInstance',
          'DeleteDBInstance',
        ]),
      },
    ],
  },
  {
    serviceName: 'rdscluster',
    queueKey: 'AutoAlarm-RdsCluster',
    rules: [
      {
        id: 'RDSClusterTagRule',
        description: 'Routes RDS Cluster tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'rds',
          'cluster',
          SERVICE_TAG_KEYS.rdscluster,
        ),
      },
      {
        id: 'RDSClusterStateRule',
        description: 'Routes RDS Cluster events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.rds', 'rds.amazonaws.com', [
          'CreateDBCluster',
          'DeleteDBCluster',
        ]),
      },
    ],
  },
  {
    serviceName: 'route53resolver',
    queueKey: 'AutoAlarm-Route53resolver',
    rules: [
      {
        id: 'Route53ResolverTagRule',
        description: 'Routes Route53Resolver tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'route53resolver',
          'resolver-endpoint',
          SERVICE_TAG_KEYS.route53resolver,
        ),
      },
      {
        id: 'Route53ResolverStateRule',
        description: 'Routes Route53Resolver events to AutoAlarm',
        eventPattern: cloudTrailPattern(
          'aws.route53resolver',
          'route53resolver.amazonaws.com',
          ['CreateResolverEndpoint', 'DeleteResolverEndpoint'],
        ),
      },
    ],
  },
  {
    serviceName: 'sqs',
    queueKey: 'AutoAlarm-Sqs',
    rules: [
      {
        id: 'SqsRule',
        description: 'Routes SQS events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.sqs', 'sqs.amazonaws.com', [
          'CreateQueue',
          'DeleteQueue',
          'TagQueue',
          'UntagQueue',
        ]),
      },
    ],
  },
  {
    serviceName: 'sfn',
    queueKey: 'AutoAlarm-Sfn',
    rules: [
      {
        id: 'SFNRule',
        description: 'Routes Step Functions events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.states', 'states.amazonaws.com', [
          'CreateStateMachine',
          'DeleteStateMachine',
        ]),
      },
      {
        id: 'SFNTagRule',
        description: 'Routes Step Functions tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'states',
          'stateMachine',
          SERVICE_TAG_KEYS.sfn,
        ),
      },
    ],
  },
  {
    serviceName: 'targetgroup',
    queueKey: 'AutoAlarm-TargetGroup',
    rules: [
      {
        id: 'TargetGroupTagRule',
        description: 'Routes Target Group tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'elasticloadbalancing',
          'targetgroup',
          SERVICE_TAG_KEYS.targetgroup,
        ),
      },
      {
        id: 'TargetGroupStateRule',
        description: 'Routes Target Group events to AutoAlarm',
        eventPattern: cloudTrailPattern(
          'aws.elasticloadbalancing',
          'elasticloadbalancing.amazonaws.com',
          ['CreateTargetGroup', 'DeleteTargetGroup'],
        ),
      },
    ],
  },
  {
    serviceName: 'transitgateway',
    queueKey: 'AutoAlarm-TransitGateway',
    rules: [
      {
        id: 'TransitGatewayTagRule',
        description: 'Routes Transit Gateway tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'ec2',
          'transit-gateway',
          SERVICE_TAG_KEYS.transitgateway,
        ),
      },
      {
        id: 'TransitGatewayStateRule',
        description: 'Routes Transit Gateway events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.ec2', 'ec2.amazonaws.com', [
          'CreateTransitGateway',
          'DeleteTransitGateway',
        ]),
      },
    ],
  },
  {
    serviceName: 'vpn',
    queueKey: 'AutoAlarm-Vpn',
    rules: [
      {
        id: 'VPNTagRule',
        description: 'Routes VPN tag events to AutoAlarm',
        eventPattern: tagChangePattern(
          'ec2',
          'vpn-connection',
          SERVICE_TAG_KEYS.vpn,
        ),
      },
      {
        id: 'VPNStateRule',
        description: 'Routes VPN events to AutoAlarm',
        eventPattern: cloudTrailPattern('aws.ec2', 'ec2.amazonaws.com', [
          'CreateVpnConnection',
          'DeleteVpnConnection',
        ]),
      },
    ],
  },
];

export class EventRules extends Construct {
  public readonly serviceRules: Map<ServiceName, Rule[]>;

  constructor(
    scope: Construct,
    id: string,
    queues: {[key: string]: NoBreachingExtendedQueue},
    eventRuleTargetDLQ: IQueue,
  ) {
    super(scope, id);
    this.serviceRules = new Map();

    for (const service of SERVICE_DESCRIPTORS) {
      const queue = queues[service.queueKey];
      if (!queue) {
        throw new Error(
          `No queue found for key "${service.queueKey}" (service: ${service.serviceName})`,
        );
      }

      const rules = service.rules.map((descriptor) => {
        const rule = new Rule(this, descriptor.id, {
          eventPattern: descriptor.eventPattern,
          description: descriptor.description,
        });

        rule.addTarget(
          new SqsQueue(queue, {
            messageGroupId: `AutoAlarm-${service.serviceName}`,
            // Capture events EventBridge could not deliver to the
            // target queue after its retry policy is exhausted.
            deadLetterQueue: eventRuleTargetDLQ,
          }),
        );

        return rule;
      });

      this.serviceRules.set(service.serviceName, rules);
    }
  }
}
