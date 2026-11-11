import {describe, test, expect} from 'vitest';
import {routeEvent, ParsedEventBody, RouteDecision} from './event-router.mjs';
import * as ServiceModules from './service-modules/_index.mjs';

/**
 * The router is pure: every test builds a synthetic event body shaped like
 * the real EventBridge events the CDK rules deliver and asserts the routing
 * decision (action kind and handler reference). Nothing is mocked and no
 * handler is invoked.
 */

function tagEvent(
  service: string,
  resourceType: string,
  arn = 'arn:aws:ec2:us-west-2:123456789012:instance/i-0123456789abcdef0',
): ParsedEventBody {
  return {
    'source': 'aws.tag',
    'detail-type': 'Tag Change on Resource',
    'resources': [arn],
    'detail': {
      'changed-tag-keys': ['autoalarm:enabled'],
      'service': service,
      'resource-type': resourceType,
      'version': 1,
      'tags': {'autoalarm:enabled': 'true'},
    },
  };
}

function cloudTrailEvent(
  source: string,
  eventSource: string,
  eventName: string,
  extraDetail: Record<string, unknown> = {},
): ParsedEventBody {
  return {
    'source': source,
    'detail-type': 'AWS API Call via CloudTrail',
    'detail': {
      eventSource: eventSource,
      eventName: eventName,
      awsRegion: 'us-west-2',
      ...extraDetail,
    },
  };
}

function expectModule(
  decision: RouteDecision,
  handler: unknown,
  args: 'body' | 'record' | 'record-account' = 'body',
) {
  expect(decision.action.kind).toBe('module');
  if (decision.action.kind === 'module') {
    expect(decision.action.handler).toBe(handler);
    expect(decision.action.args).toBe(args);
  }
}

describe('direct event sources', () => {
  test('aws.ecs routes to the ECS module with record and account id', () => {
    const decision = routeEvent({
      'source': 'aws.ecs',
      'detail-type': 'ECS Service Action',
      'detail': {eventName: 'SERVICE_STEADY_STATE'},
    });
    expect(decision.name).toBe('ecs');
    expectModule(
      decision,
      ServiceModules.parseECSEventAndCreateAlarms,
      'record-account',
    );
  });

  test('aws.logs routes to the log group module with the raw record', () => {
    const decision = routeEvent(
      cloudTrailEvent('aws.logs', 'logs.amazonaws.com', 'CreateLogGroup', {
        requestParameters: {logGroupName: '/aws/lambda/my-function'},
      }),
    );
    expect(decision.name).toBe('log-group');
    expectModule(
      decision,
      ServiceModules.parseLogGroupEventAndCreateAlarms,
      'record',
    );
  });

  test('aws.cloudfront routes to the CloudFront module', () => {
    const decision = routeEvent(
      cloudTrailEvent(
        'aws.cloudfront',
        'cloudfront.amazonaws.com',
        'CreateDistribution',
      ),
    );
    expect(decision.name).toBe('cloudfront');
    expectModule(decision, ServiceModules.parseCloudFrontEventAndCreateAlarms);
  });

  test('aws.es and aws.opensearch route to the OpenSearch module', () => {
    for (const src of ['aws.es', 'aws.opensearch']) {
      const decision = routeEvent(
        cloudTrailEvent(src, 'es.amazonaws.com', 'CreateDomain'),
      );
      expect(decision.name).toBe('opensearch');
      expectModule(decision, ServiceModules.parseOSEventAndCreateAlarms);
    }
  });

  test('aws.route53resolver routes to the Route53 resolver module', () => {
    const decision = routeEvent(
      cloudTrailEvent(
        'aws.route53resolver',
        'route53resolver.amazonaws.com',
        'CreateResolverEndpoint',
      ),
    );
    expect(decision.name).toBe('route53-resolver');
    expectModule(decision, ServiceModules.parseR53ResolverEventAndCreateAlarms);
  });

  test('aws.sqs routes to the SQS module', () => {
    const decision = routeEvent(
      cloudTrailEvent('aws.sqs', 'sqs.amazonaws.com', 'CreateQueue'),
    );
    expect(decision.name).toBe('sqs');
    expectModule(decision, ServiceModules.parseSQSEventAndCreateAlarms);
  });

  test('aws.states routes to the Step Functions module', () => {
    const decision = routeEvent(
      cloudTrailEvent(
        'aws.states',
        'states.amazonaws.com',
        'CreateStateMachine',
      ),
    );
    expect(decision.name).toBe('step-functions');
    expectModule(decision, ServiceModules.parseSFNEventAndCreateAlarms);
  });

  test('aws.lambda create/delete routes to the Lambda module', () => {
    // Lambda records the create API with a version suffix; both names match.
    for (const name of [
      'CreateFunction20150331',
      'CreateFunction20150331v2',
      'DeleteFunction20150331',
      'DeleteFunction20150331v2',
    ]) {
      const decision = routeEvent(
        cloudTrailEvent('aws.lambda', 'lambda.amazonaws.com', name),
      );
      expect(decision.name).toBe('lambda');
      expectModule(decision, ServiceModules.parseLambdaEventAndCreateAlarms);
    }
  });

  test('aws.lambda with an unversioned/unhandled eventName falls through to unhandled', () => {
    const decision = routeEvent(
      cloudTrailEvent('aws.lambda', 'lambda.amazonaws.com', 'CreateFunction'),
    );
    expect(decision.name).toBe('unhandled-event-source');
    expect(decision.action.kind).toBe('fail');
  });
});

describe('aws.ec2 events', () => {
  test('instance state-change notification is accumulated for batch processing', () => {
    const decision = routeEvent({
      'source': 'aws.ec2',
      'detail-type': 'EC2 Instance State-change Notification',
      'detail': {'instance-id': 'i-0123456789abcdef0', 'state': 'running'},
    });
    expect(decision.name).toBe('ec2-instance-state-change');
    expect(decision.action.kind).toBe('accumulate-ec2');
  });

  test('CloudTrail VPN event without detail.resourceType routes to the VPN module', () => {
    // The old bug class: CloudTrail events carry no detail.resourceType and
    // each needed a hand-written special case (VPN: 9239dc8).
    for (const name of ['CreateVpnConnection', 'DeleteVpnConnection']) {
      const decision = routeEvent(
        cloudTrailEvent('aws.ec2', 'ec2.amazonaws.com', name, {
          responseElements: {vpnConnection: {vpnConnectionId: 'vpn-123'}},
        }),
      );
      expect(decision.name).toBe('ec2-cloudtrail-vpn');
      expectModule(decision, ServiceModules.parseVpnEventAndCreateAlarms);
    }
  });

  test('CloudTrail Transit Gateway event without detail.resourceType routes to the TGW module', () => {
    // The old bug class: the identical Transit Gateway gap was open until #226.
    for (const name of ['CreateTransitGateway', 'DeleteTransitGateway']) {
      const decision = routeEvent(
        cloudTrailEvent('aws.ec2', 'ec2.amazonaws.com', name, {
          responseElements: {transitGateway: {transitGatewayId: 'tgw-123'}},
        }),
      );
      expect(decision.name).toBe('ec2-cloudtrail-transit-gateway');
      expectModule(
        decision,
        ServiceModules.parseTransitGatewayEventAndCreateAlarms,
      );
    }
  });

  test('event with detail.resourceType instance is accumulated for batch processing', () => {
    const decision = routeEvent({
      source: 'aws.ec2',
      detail: {resourceType: 'instance', eventName: 'RunInstances'},
    });
    expect(decision.name).toBe('ec2-resource-type-instance');
    expect(decision.action.kind).toBe('accumulate-ec2');
  });

  test('vpn-connection resourceType with a VPN eventName routes to the VPN module', () => {
    const decision = routeEvent({
      source: 'aws.ec2',
      detail: {
        resourceType: 'vpn-connection',
        eventName: 'CreateVpnConnection',
      },
    });
    expect(decision.name).toBe('ec2-resource-type-vpn');
    expectModule(decision, ServiceModules.parseVpnEventAndCreateAlarms);
  });

  test('vpn-connection resourceType with another eventName is skipped (acked, not failed)', () => {
    const decision = routeEvent({
      source: 'aws.ec2',
      detail: {
        resourceType: 'vpn-connection',
        eventName: 'ModifyVpnConnection',
      },
    });
    expect(decision.name).toBe('ec2-resource-type-vpn-ignored-event-name');
    expect(decision.action.kind).toBe('skip');
  });

  test('unknown detail.resourceType fails the record', () => {
    const body: ParsedEventBody = {
      source: 'aws.ec2',
      detail: {resourceType: 'volume', eventName: 'CreateVolume'},
    };
    const decision = routeEvent(body);
    expect(decision.name).toBe('ec2-unhandled-resource-type');
    expect(decision.action.kind).toBe('fail');
    if (decision.action.kind === 'fail') {
      expect(decision.action.level).toBe('error');
      expect(decision.action.message(body)).toBe(
        'Unhandled resource type for aws.ec2: volume',
      );
    }
  });

  test('CloudTrail event with an unhandled eventName and no resourceType fails the record', () => {
    const decision = routeEvent(
      cloudTrailEvent('aws.ec2', 'ec2.amazonaws.com', 'CreateVolume'),
    );
    expect(decision.name).toBe('ec2-unhandled-format');
    expect(decision.action.kind).toBe('fail');
  });

  test('aws.ec2 event with no detail at all fails the record', () => {
    const decision = routeEvent({source: 'aws.ec2'});
    expect(decision.name).toBe('ec2-unhandled-format');
    expect(decision.action.kind).toBe('fail');
  });
});

describe('aws.elasticloadbalancing events', () => {
  test('load balancer create/delete routes to the ALB module', () => {
    for (const name of ['CreateLoadBalancer', 'DeleteLoadBalancer']) {
      const decision = routeEvent(
        cloudTrailEvent(
          'aws.elasticloadbalancing',
          'elasticloadbalancing.amazonaws.com',
          name,
        ),
      );
      expect(decision.name).toBe('elb-load-balancer');
      expectModule(decision, ServiceModules.parseALBEventAndCreateAlarms);
    }
  });

  test('target group create/delete routes to the target group module', () => {
    for (const name of ['CreateTargetGroup', 'DeleteTargetGroup']) {
      const decision = routeEvent(
        cloudTrailEvent(
          'aws.elasticloadbalancing',
          'elasticloadbalancing.amazonaws.com',
          name,
        ),
      );
      expect(decision.name).toBe('elb-target-group');
      expectModule(decision, ServiceModules.parseTGEventAndCreateAlarms);
    }
  });

  test('unhandled eventName fails the record', () => {
    const decision = routeEvent(
      cloudTrailEvent(
        'aws.elasticloadbalancing',
        'elasticloadbalancing.amazonaws.com',
        'ModifyLoadBalancerAttributes',
      ),
    );
    expect(decision.name).toBe('elb-unhandled-event-name');
    expect(decision.action.kind).toBe('fail');
  });
});

describe('aws.rds events', () => {
  test('DB instance create/delete routes to the RDS module', () => {
    for (const name of ['CreateDBInstance', 'DeleteDBInstance']) {
      const decision = routeEvent(
        cloudTrailEvent('aws.rds', 'rds.amazonaws.com', name),
      );
      expect(decision.name).toBe('rds-instance');
      expectModule(decision, ServiceModules.parseRDSEventAndCreateAlarms);
    }
  });

  test('DB cluster create/delete routes to the RDS cluster module', () => {
    for (const name of ['CreateDBCluster', 'DeleteDBCluster']) {
      const decision = routeEvent(
        cloudTrailEvent('aws.rds', 'rds.amazonaws.com', name),
      );
      expect(decision.name).toBe('rds-cluster');
      expectModule(
        decision,
        ServiceModules.parseRDSClusterEventAndCreateAlarms,
      );
    }
  });

  test('unhandled eventName fails the record', () => {
    const decision = routeEvent(
      cloudTrailEvent('aws.rds', 'rds.amazonaws.com', 'ModifyDBInstance'),
    );
    expect(decision.name).toBe('rds-unhandled-event-name');
    expect(decision.action.kind).toBe('fail');
  });
});

describe('aws.tag events', () => {
  test('EC2 instance tag events (service ec2 or aws.ec2) are accumulated', () => {
    for (const service of ['ec2', 'aws.ec2']) {
      const decision = routeEvent(tagEvent(service, 'instance'));
      expect(decision.name).toBe('tag-ec2-instance');
      expect(decision.action.kind).toBe('accumulate-ec2-tag');
    }
  });

  test('transit-gateway tag events route to the TGW module', () => {
    const decision = routeEvent(tagEvent('ec2', 'transit-gateway'));
    expect(decision.name).toBe('tag-ec2-transit-gateway');
    expectModule(
      decision,
      ServiceModules.parseTransitGatewayEventAndCreateAlarms,
    );
  });

  test('vpn-connection tag events route to the VPN module', () => {
    const decision = routeEvent(tagEvent('ec2', 'vpn-connection'));
    expect(decision.name).toBe('tag-ec2-vpn');
    expectModule(decision, ServiceModules.parseVpnEventAndCreateAlarms);
  });

  test('unhandled ec2 tag resource-type is skipped with a warning', () => {
    const decision = routeEvent(tagEvent('ec2', 'security-group'));
    expect(decision.name).toBe('tag-ec2-unhandled-resource-type');
    expect(decision.action.kind).toBe('skip');
  });

  test('elasticloadbalancing tag events route by resource-type', () => {
    const lb = routeEvent(tagEvent('elasticloadbalancing', 'loadbalancer'));
    expect(lb.name).toBe('tag-elb-load-balancer');
    expectModule(lb, ServiceModules.parseALBEventAndCreateAlarms);

    const tg = routeEvent(tagEvent('elasticloadbalancing', 'targetgroup'));
    expect(tg.name).toBe('tag-elb-target-group');
    expectModule(tg, ServiceModules.parseTGEventAndCreateAlarms);

    const other = routeEvent(tagEvent('elasticloadbalancing', 'listener'));
    expect(other.name).toBe('tag-elb-unhandled-resource-type');
    expect(other.action.kind).toBe('skip');
  });

  test('es tag events route to the OpenSearch module', () => {
    const decision = routeEvent(tagEvent('es', 'domain'));
    expect(decision.name).toBe('tag-opensearch');
    expectModule(decision, ServiceModules.parseOSEventAndCreateAlarms);
  });

  test('route53resolver tag events route to the resolver module', () => {
    const decision = routeEvent(
      tagEvent('route53resolver', 'resolver-endpoint'),
    );
    expect(decision.name).toBe('tag-route53-resolver');
    expectModule(decision, ServiceModules.parseR53ResolverEventAndCreateAlarms);
  });

  test('cloudfront tag events route to the CloudFront module', () => {
    const decision = routeEvent(tagEvent('cloudfront', 'distribution'));
    expect(decision.name).toBe('tag-cloudfront');
    expectModule(decision, ServiceModules.parseCloudFrontEventAndCreateAlarms);
  });

  test('rds tag events route by resource-type', () => {
    const cluster = routeEvent(tagEvent('rds', 'cluster'));
    expect(cluster.name).toBe('tag-rds-cluster');
    expectModule(cluster, ServiceModules.parseRDSClusterEventAndCreateAlarms);

    const db = routeEvent(tagEvent('rds', 'db'));
    expect(db.name).toBe('tag-rds-db');
    expectModule(db, ServiceModules.parseRDSEventAndCreateAlarms);

    const other = routeEvent(tagEvent('rds', 'snapshot'));
    expect(other.name).toBe('tag-rds-unhandled-resource-type');
    expect(other.action.kind).toBe('skip');
  });

  test('states tag events route to the Step Functions module', () => {
    const decision = routeEvent(tagEvent('states', 'stateMachine'));
    expect(decision.name).toBe('tag-step-functions');
    expectModule(decision, ServiceModules.parseSFNEventAndCreateAlarms);
  });

  test('lambda tag events route to the Lambda module', () => {
    const decision = routeEvent(
      tagEvent(
        'lambda',
        'function',
        'arn:aws:lambda:us-west-2:123456789012:function:my-function',
      ),
    );
    expect(decision.name).toBe('tag-lambda');
    expectModule(decision, ServiceModules.parseLambdaEventAndCreateAlarms);
  });

  test('tag events for an unhandled service are skipped with a warning', () => {
    const decision = routeEvent(tagEvent('kinesis', 'stream'));
    expect(decision.name).toBe('tag-unhandled-service');
    expect(decision.action.kind).toBe('skip');
  });

  test('parity quirk: service aws.ec2 with non-instance resource-type falls through to unhandled service', () => {
    // The old routeTagEvent only matched service === 'ec2'; 'aws.ec2' was
    // only honored for instance tag events, everything else hit the default.
    const decision = routeEvent(tagEvent('aws.ec2', 'transit-gateway'));
    expect(decision.name).toBe('tag-unhandled-service');
    expect(decision.action.kind).toBe('skip');
  });
});

describe('unmatched events', () => {
  test('unknown source produces a failure decision (warn + batch item failure)', () => {
    const decision = routeEvent({
      'source': 'aws.kinesis',
      'detail-type': 'AWS API Call via CloudTrail',
      'detail': {
        eventSource: 'kinesis.amazonaws.com',
        eventName: 'CreateStream',
      },
    });
    expect(decision.name).toBe('unhandled-event-source');
    expect(decision.action.kind).toBe('fail');
    if (decision.action.kind === 'fail') {
      expect(decision.action.level).toBe('warn');
      expect(decision.action.message({source: 'aws.kinesis'})).toBe(
        'Unhandled event source: aws.kinesis',
      );
    }
  });

  test('body without a source produces a failure decision', () => {
    const decision = routeEvent({detail: {eventName: 'Anything'}});
    expect(decision.name).toBe('unhandled-event-source');
    expect(decision.action.kind).toBe('fail');
  });
});
