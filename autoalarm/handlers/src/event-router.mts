import {SQSRecord} from 'aws-lambda';
import * as ServiceModules from './service-modules/_index.mjs';

/**
 * Loosely-typed shape of a parsed SQS record body (an EventBridge event).
 * Only the fields the router inspects are declared; everything else is
 * carried through untouched.
 */
export interface ParsedEventBody {
  'source'?: string;
  'detail-type'?: string;
  'detail'?: {
    'eventSource'?: string;
    'eventName'?: string;
    'resourceType'?: string;
    'service'?: string;
    'resource-type'?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Predicate evaluated against a parsed event body. */
export type Matcher = (body: ParsedEventBody) => boolean;

/** Service-module handler invoked with the parsed event body. */
export type EventHandler = (event: ParsedEventBody) => Promise<unknown>;

/** Service-module handler invoked with the raw SQS record. */
export type RecordHandler = (record: SQSRecord) => Promise<unknown>;

/** Service-module handler invoked with the raw SQS record and account id. */
export type RecordAccountHandler = (
  record: SQSRecord,
  accountId: string,
) => Promise<unknown>;

/**
 * What the main handler should do with a matched event.
 *
 * - `module`: await the referenced service-module handler. `args` selects the
 *   call shape (parsed body, raw SQS record, or record + account id).
 * - `accumulate-ec2` / `accumulate-ec2-tag`: the main handler appends the
 *   event to the corresponding deferred-processing array; the post-loop EC2
 *   batch processing is unchanged.
 * - `skip`: acknowledge the record without processing. `silent` suppresses
 *   the warn log for paths that historically dropped the record without
 *   logging.
 * - `fail`: log at `level` and report the record as a batch item failure.
 */
export type RouteAction =
  | {kind: 'module'; handler: EventHandler; args: 'body'}
  | {kind: 'module'; handler: RecordHandler; args: 'record'}
  | {kind: 'module'; handler: RecordAccountHandler; args: 'record-account'}
  | {kind: 'accumulate-ec2'}
  | {kind: 'accumulate-ec2-tag'}
  | {kind: 'skip'; silent?: boolean; message: (body: ParsedEventBody) => string}
  | {
      kind: 'fail';
      level: 'warn' | 'error';
      message: (body: ParsedEventBody) => string;
    };

/** A single entry in the ordered routing registry. */
export interface RouteEntry {
  name: string;
  matches: Matcher;
  action: RouteAction;
}

/** The routing outcome for one event: the matched entry name and its action. */
export interface RouteDecision {
  name: string;
  action: RouteAction;
}

/*
 * Matcher combinators
 */

/** Matches when `body.source` is one of the given event sources. */
export function source(...sources: string[]): Matcher {
  return (body) =>
    typeof body.source === 'string' && sources.includes(body.source);
}

/** Matches when `body['detail-type']` equals the given detail type. */
export function detailType(type: string): Matcher {
  return (body) => body['detail-type'] === type;
}

/** Matches when `body.detail.eventName` is one of the given names. */
export function eventName(...names: string[]): Matcher {
  return (body) =>
    typeof body.detail?.eventName === 'string' &&
    names.includes(body.detail.eventName);
}

/** Matches when `body.detail.eventSource` equals the given CloudTrail source. */
export function eventSource(src: string): Matcher {
  return (body) => body.detail?.eventSource === src;
}

/** Matches when `body.detail.resourceType` equals the given type. */
export function detailResourceType(type: string): Matcher {
  return (body) => body.detail?.resourceType === type;
}

/** Matches when `body.detail.resourceType` is present (truthy). */
export function hasDetailResourceType(): Matcher {
  return (body) => Boolean(body.detail?.resourceType);
}

/** Matches when `body.detail.service` (tag events) is one of the given services. */
export function tagService(...services: string[]): Matcher {
  return (body) =>
    typeof body.detail?.service === 'string' &&
    services.includes(body.detail.service);
}

/** Matches when `body.detail['resource-type']` (tag events) equals the given type. */
export function tagResourceType(type: string): Matcher {
  return (body) => body.detail?.['resource-type'] === type;
}

/** Matches when every given matcher matches. */
export function all(...matchers: Matcher[]): Matcher {
  return (body) => matchers.every((matcher) => matcher(body));
}

/*
 * Action helpers
 */

function module(handler: EventHandler): RouteAction {
  return {kind: 'module', handler, args: 'body'};
}

function recordModule(handler: RecordHandler): RouteAction {
  return {kind: 'module', handler, args: 'record'};
}

function recordAccountModule(handler: RecordAccountHandler): RouteAction {
  return {kind: 'module', handler, args: 'record-account'};
}

/**
 * Ordered routing registry. The first entry whose matcher returns true wins,
 * so put more specific matchers before broader fallbacks for the same source.
 *
 * Adding a new service is a one-entry change here (plus its service module).
 */
export const eventRoutes: RouteEntry[] = [
  /*
   * Direct event sources
   */
  {
    name: 'ecs',
    matches: source('aws.ecs'),
    action: recordAccountModule(ServiceModules.parseECSEventAndCreateAlarms),
  },
  {
    name: 'log-group',
    matches: source('aws.logs'),
    action: recordModule(ServiceModules.parseLogGroupEventAndCreateAlarms),
  },
  {
    name: 'cloudfront',
    matches: source('aws.cloudfront'),
    action: module(ServiceModules.parseCloudFrontEventAndCreateAlarms),
  },

  /*
   * aws.ec2 — state-change notifications, CloudTrail API calls (which carry
   * no detail.resourceType), then resourceType-tagged events, then fallbacks.
   */
  {
    name: 'ec2-instance-state-change',
    matches: all(
      source('aws.ec2'),
      detailType('EC2 Instance State-change Notification'),
    ),
    action: {kind: 'accumulate-ec2'},
  },
  {
    // CloudTrail VPN events have no detail.resourceType; route by
    // detail-type, eventSource, and eventName.
    name: 'ec2-cloudtrail-vpn',
    matches: all(
      source('aws.ec2'),
      detailType('AWS API Call via CloudTrail'),
      eventSource('ec2.amazonaws.com'),
      eventName('CreateVpnConnection', 'DeleteVpnConnection'),
    ),
    action: module(ServiceModules.parseVpnEventAndCreateAlarms),
  },
  {
    // CloudTrail Transit Gateway events have no detail.resourceType; route by
    // detail-type, eventSource, and eventName.
    name: 'ec2-cloudtrail-transit-gateway',
    matches: all(
      source('aws.ec2'),
      detailType('AWS API Call via CloudTrail'),
      eventSource('ec2.amazonaws.com'),
      eventName('CreateTransitGateway', 'DeleteTransitGateway'),
    ),
    action: module(ServiceModules.parseTransitGatewayEventAndCreateAlarms),
  },
  {
    name: 'ec2-resource-type-instance',
    matches: all(source('aws.ec2'), detailResourceType('instance')),
    action: {kind: 'accumulate-ec2'},
  },
  {
    name: 'ec2-resource-type-vpn',
    matches: all(
      source('aws.ec2'),
      detailResourceType('vpn-connection'),
      eventName('CreateVpnConnection', 'DeleteVpnConnection'),
    ),
    action: module(ServiceModules.parseVpnEventAndCreateAlarms),
  },
  {
    // Parity with the old switch: a vpn-connection resourceType with any
    // other eventName was acknowledged without processing or logging.
    name: 'ec2-resource-type-vpn-ignored-event-name',
    matches: all(source('aws.ec2'), detailResourceType('vpn-connection')),
    action: {
      kind: 'skip',
      silent: true,
      message: (body) =>
        `Ignoring vpn-connection event with unhandled eventName: ${body.detail?.eventName}`,
    },
  },
  {
    name: 'ec2-unhandled-resource-type',
    matches: all(source('aws.ec2'), hasDetailResourceType()),
    action: {
      kind: 'fail',
      level: 'error',
      message: (body) =>
        `Unhandled resource type for aws.ec2: ${body.detail?.resourceType}`,
    },
  },
  {
    name: 'ec2-unhandled-format',
    matches: source('aws.ec2'),
    action: {
      kind: 'fail',
      level: 'error',
      message: () => 'Unhandled EC2 event format',
    },
  },

  /*
   * aws.elasticloadbalancing (CloudTrail)
   */
  {
    name: 'elb-load-balancer',
    matches: all(
      source('aws.elasticloadbalancing'),
      eventName('CreateLoadBalancer', 'DeleteLoadBalancer'),
    ),
    action: module(ServiceModules.parseALBEventAndCreateAlarms),
  },
  {
    name: 'elb-target-group',
    matches: all(
      source('aws.elasticloadbalancing'),
      eventName('CreateTargetGroup', 'DeleteTargetGroup'),
    ),
    action: module(ServiceModules.parseTGEventAndCreateAlarms),
  },
  {
    name: 'elb-unhandled-event-name',
    matches: source('aws.elasticloadbalancing'),
    action: {
      kind: 'fail',
      level: 'error',
      message: () => 'Unhandled event name for aws.elasticloadbalancing',
    },
  },

  /*
   * OpenSearch — CloudTrail events arrive with source 'aws.es'
   */
  {
    name: 'opensearch',
    matches: source('aws.es', 'aws.opensearch'),
    action: module(ServiceModules.parseOSEventAndCreateAlarms),
  },

  /*
   * aws.rds (CloudTrail)
   */
  {
    name: 'rds-instance',
    matches: all(
      source('aws.rds'),
      eventName('CreateDBInstance', 'DeleteDBInstance'),
    ),
    action: module(ServiceModules.parseRDSEventAndCreateAlarms),
  },
  {
    name: 'rds-cluster',
    matches: all(
      source('aws.rds'),
      eventName('CreateDBCluster', 'DeleteDBCluster'),
    ),
    action: module(ServiceModules.parseRDSClusterEventAndCreateAlarms),
  },
  {
    name: 'rds-unhandled-event-name',
    matches: source('aws.rds'),
    action: {
      kind: 'fail',
      level: 'error',
      message: () => 'Unhandled event name for aws.rds',
    },
  },

  /*
   * Remaining direct sources
   */
  {
    name: 'route53-resolver',
    matches: source('aws.route53resolver'),
    action: module(ServiceModules.parseR53ResolverEventAndCreateAlarms),
  },
  {
    name: 'sqs',
    matches: source('aws.sqs'),
    action: module(ServiceModules.parseSQSEventAndCreateAlarms),
  },
  {
    name: 'step-functions',
    matches: source('aws.states'),
    action: module(ServiceModules.parseSFNEventAndCreateAlarms),
  },
  {
    // Lambda CloudTrail create/delete events. Current Lambda management
    // events carry a "...v2" suffix (verified against a live us-west-2
    // CloudTrail record: TagResource20170331v2), so both the legacy and v2
    // names are matched for create and delete.
    name: 'lambda',
    matches: all(
      source('aws.lambda'),
      eventName(
        'CreateFunction20150331',
        'CreateFunction20150331v2',
        'DeleteFunction20150331',
        'DeleteFunction20150331v2',
      ),
    ),
    action: module(ServiceModules.parseLambdaEventAndCreateAlarms),
  },

  /*
   * aws.tag — Tag Change on Resource events, keyed on detail.service and
   * detail['resource-type']. EC2 instance tag events are accumulated for
   * deferred batch processing; everything else dispatches directly.
   */
  {
    name: 'tag-ec2-instance',
    matches: all(
      source('aws.tag'),
      tagService('ec2', 'aws.ec2'),
      tagResourceType('instance'),
    ),
    action: {kind: 'accumulate-ec2-tag'},
  },
  {
    // Transit Gateway and VPN tag events arrive with service 'ec2' and are
    // distinguished by resource-type.
    name: 'tag-ec2-transit-gateway',
    matches: all(
      source('aws.tag'),
      tagService('ec2'),
      tagResourceType('transit-gateway'),
    ),
    action: module(ServiceModules.parseTransitGatewayEventAndCreateAlarms),
  },
  {
    name: 'tag-ec2-vpn',
    matches: all(
      source('aws.tag'),
      tagService('ec2'),
      tagResourceType('vpn-connection'),
    ),
    action: module(ServiceModules.parseVpnEventAndCreateAlarms),
  },
  {
    name: 'tag-ec2-unhandled-resource-type',
    matches: all(source('aws.tag'), tagService('ec2')),
    action: {
      kind: 'skip',
      message: (body) =>
        `Unhandled resource type for EC2: ${body.detail?.['resource-type']}`,
    },
  },
  {
    name: 'tag-elb-load-balancer',
    matches: all(
      source('aws.tag'),
      tagService('elasticloadbalancing'),
      tagResourceType('loadbalancer'),
    ),
    action: module(ServiceModules.parseALBEventAndCreateAlarms),
  },
  {
    name: 'tag-elb-target-group',
    matches: all(
      source('aws.tag'),
      tagService('elasticloadbalancing'),
      tagResourceType('targetgroup'),
    ),
    action: module(ServiceModules.parseTGEventAndCreateAlarms),
  },
  {
    name: 'tag-elb-unhandled-resource-type',
    matches: all(source('aws.tag'), tagService('elasticloadbalancing')),
    action: {
      kind: 'skip',
      message: (body) =>
        `Unhandled resource type for ELB: ${body.detail?.['resource-type']}`,
    },
  },
  {
    name: 'tag-opensearch',
    matches: all(source('aws.tag'), tagService('es')),
    action: module(ServiceModules.parseOSEventAndCreateAlarms),
  },
  {
    name: 'tag-route53-resolver',
    matches: all(source('aws.tag'), tagService('route53resolver')),
    action: module(ServiceModules.parseR53ResolverEventAndCreateAlarms),
  },
  {
    name: 'tag-cloudfront',
    matches: all(source('aws.tag'), tagService('cloudfront')),
    action: module(ServiceModules.parseCloudFrontEventAndCreateAlarms),
  },
  {
    name: 'tag-rds-cluster',
    matches: all(
      source('aws.tag'),
      tagService('rds'),
      tagResourceType('cluster'),
    ),
    action: module(ServiceModules.parseRDSClusterEventAndCreateAlarms),
  },
  {
    name: 'tag-rds-db',
    matches: all(source('aws.tag'), tagService('rds'), tagResourceType('db')),
    action: module(ServiceModules.parseRDSEventAndCreateAlarms),
  },
  {
    name: 'tag-rds-unhandled-resource-type',
    matches: all(source('aws.tag'), tagService('rds')),
    action: {
      kind: 'skip',
      message: (body) =>
        `Unhandled RDS resource: ${body.detail?.['resource-type']}`,
    },
  },
  {
    name: 'tag-step-functions',
    matches: all(source('aws.tag'), tagService('states')),
    action: module(ServiceModules.parseSFNEventAndCreateAlarms),
  },
  {
    name: 'tag-lambda',
    matches: all(
      source('aws.tag'),
      tagService('lambda'),
      tagResourceType('function'),
    ),
    action: module(ServiceModules.parseLambdaEventAndCreateAlarms),
  },
  {
    name: 'tag-unhandled-service',
    matches: source('aws.tag'),
    action: {
      kind: 'skip',
      message: (body) => `Unhandled service: ${body.detail?.service}`,
    },
  },
];

/**
 * Routes a parsed event body through the registry. Returns the first matching
 * entry's decision; events that match no entry fail the record (same outcome
 * as the old switch's default case).
 */
export function routeEvent(body: ParsedEventBody): RouteDecision {
  for (const entry of eventRoutes) {
    if (entry.matches(body)) {
      return {name: entry.name, action: entry.action};
    }
  }
  return {
    name: 'unhandled-event-source',
    action: {
      kind: 'fail',
      level: 'warn',
      message: (b) => `Unhandled event source: ${b.source}`,
    },
  };
}
