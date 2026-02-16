import {
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
} from 'aws-cdk-lib/aws-cloudfront';
import {Construct} from 'constructs';

export const DEFAULT_API_ORIGIN_HEADERS = [
  'Accept',
  'Accept-Language',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Content-Type',
  'Origin',
  'Referer',
];

export class StandardApiOriginRequestPolicy extends OriginRequestPolicy {
  constructor(scope: Construct, id: string, additionalHeaders?: string[]) {
    super(scope, id, {
      cookieBehavior: OriginRequestCookieBehavior.all(),
      queryStringBehavior: OriginRequestQueryStringBehavior.all(),
      headerBehavior: OriginRequestHeaderBehavior.allowList(
        ...DEFAULT_API_ORIGIN_HEADERS,
        ...(additionalHeaders ?? []),
      ),
    });
  }
}
