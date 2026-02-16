import {
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
} from 'aws-cdk-lib/aws-cloudfront';
import {Construct} from 'constructs';
import {Duration} from 'aws-cdk-lib';

export const DEFAULT_API_CACHE_HEADERS = [
  'Accept',
  'Accept-Language',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Authorization',
];

export class StandardApiCachePolicy extends CachePolicy {
  constructor(scope: Construct, id: string, additionalHeaders?: string[]) {
    super(scope, id, {
      maxTtl: Duration.seconds(31536000), // 365 days
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      cookieBehavior: CacheCookieBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList(
        ...DEFAULT_API_CACHE_HEADERS,
        ...(additionalHeaders ?? []),
      ),
      queryStringBehavior: CacheQueryStringBehavior.all(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });
  }
}
