import {Construct} from 'constructs';
import {
  DistributionBuilder,
  Invalidation,
  RobotsBehavior,
} from '../../aws-cloudfront';
import {DomainName} from '../../aws-route53';
import {BestOriginFunction} from './best-origin-function';
import {
  FunctionCode,
  FunctionRuntime,
  Function,
  OriginProtocolPolicy,
  OriginSslPolicy,
  LambdaEdgeEventType,
  FunctionEventType,
  ResponseHeadersPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import {HttpOrigin} from 'aws-cdk-lib/aws-cloudfront-origins';
import {Duration} from 'aws-cdk-lib';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';
import {RecordTarget} from 'aws-cdk-lib/aws-route53';
import * as fs from 'fs';
import * as path from 'path';

export interface AppFunctionEdgeDomainName {
  readonly prefix?: string;
  readonly zone: string;
}

export interface AppFunctionEdgeProps {
  readonly entry: string;
  readonly originZone: string;
  readonly originFunctionPrefix: string;
  readonly originContentPrefix: string;
  readonly domainNames: AppFunctionEdgeDomainName[];
  readonly robotsBehavior: RobotsBehavior;
  readonly invalidate: boolean;
  readonly comment: string;
  readonly disassociateFunctions?: boolean;
  readonly additionalContentPaths?: string[];
}

export class AppFunctionEdge extends Construct {
  readonly url: string;
  constructor(scope: Construct, id: string, props: AppFunctionEdgeProps) {
    super(scope, id);

    if (props.domainNames.length < 1) {
      throw new Error('At least one domain name is required');
    }

    const domainNames = props.domainNames.map((domainName) => {
      return new DomainName({
        prefix: domainName.prefix ?? '',
        zone: domainName.zone,
      });
    });
    this.url = `https://${domainNames[0].toString()}/`;

    const wwwDomainNames = props.domainNames.map((domainName) => {
      return new DomainName({
        prefix: domainName.prefix ? `www.${domainName.prefix}` : 'www',
        zone: domainName.zone,
      });
    });

    domainNames.push(...wwwDomainNames);

    const certificate = DomainName.createCertificate(
      this,
      'Certificate',
      domainNames,
    );

    const bestOriginFunction = new BestOriginFunction(
      this,
      'BestOriginFunction',
    );

    const headerProcessingFunction = new Function(
      this,
      'HeaderProcessingFunction',
      {
        code: FunctionCode.fromInline(`
function handler(event) {
  const request = event.request;
  const headers = request.headers;
  const host = headers.host ? headers.host.value : undefined;

  if (host && host.startsWith('www.')) {
    const uri = request.uri || '';
    let querystring = '';
    if (request.querystring) {
      const params = Object.keys(request.querystring)
        .map(key => \`\${key}=\${request.querystring[key].value}\`)
        .join('&');
      querystring = params ? \`?\${params}\` : '';
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: \`https://\${host.slice(4)}\${uri}\${querystring}\` }
      }
    };
  }

  // Forward the host header
  if (host) {
    headers['x-forwarded-host'] = { value: host };
  }
  return request;
}`),
        runtime: FunctionRuntime.JS_2_0,
      },
    );

    const appOrigin = new HttpOrigin(
      `${props.originFunctionPrefix}.${props.originZone}`,
      {
        originId: props.originFunctionPrefix,
        protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
        originSslProtocols: [OriginSslPolicy.TLS_V1_2],
        readTimeout: Duration.seconds(59),
        keepaliveTimeout: Duration.seconds(60),
      },
    );

    const appContentOrigin = new HttpOrigin(
      `${props.originContentPrefix}.${props.originZone}`,
      {
        originId: props.originContentPrefix,
        protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
      },
    );

    const responseHeadersPolicy = new ResponseHeadersPolicy(
      this,
      'ResponseHeadersPolicy',
      {
        securityHeadersBehavior: {
          // X-Content-Type-Options: nosniff
          contentTypeOptions: {
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.seconds(31536000), // 1 year
            includeSubdomains: true,
            override: true,
          },
        },
      },
    );

    const builder = new DistributionBuilder(this, 'Default')
      .comment(props.comment)
      .domainNames(...domainNames)
      .certificate(certificate)
      .behavior(appOrigin)
      .apiDefaults(['X-Qrl', 'x-forwarded-host']) // headers used by QwikJS RPC and API authentication
      .responseHeadersPolicy(responseHeadersPolicy)
      .edgeLambdas(
        props.disassociateFunctions
          ? []
          : [
              {
                eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                functionVersion: bestOriginFunction.currentVersion,
              },
            ],
      )
      .functionAssociations(
        props.disassociateFunctions
          ? []
          : [
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                function: headerProcessingFunction,
              },
            ],
      );
    for (const p of [
      'build/*',
      'assets/*',
      'favicon*',
      'android-*',
      'apple-*',
      '404.html',
      'service-worker.js',
      'qwik-prefetch-service-worker.js',
      'q-manifest.json',
      'manifest.json',
      'sitemap.xml',
      ...fs
        .readdirSync(path.join(props.entry, 'public'), {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((file) => `${file.name}/*`),
      ...(props.additionalContentPaths ?? []),
    ]) {
      builder
        .behavior(appContentOrigin, p)
        .edgeLambdas(
          props.disassociateFunctions
            ? []
            : [
                {
                  eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                  functionVersion: bestOriginFunction.currentVersion,
                },
              ],
        )
        .s3Defaults();
    }
    const distribution = builder.toDistribution();
    const target = new CloudFrontTarget(distribution);
    for (const domainName of domainNames) {
      domainName.createARecord(this, RecordTarget.fromAlias(target));
    }

    if (props.invalidate ?? false) {
      new Invalidation(this, 'Invalidation', {
        distributionId: distribution.distributionId,
        paths: ['/*'],
      });
    }
  }
}
