import {Construct} from 'constructs';
import {Code, Function, Runtime} from 'aws-cdk-lib/aws-lambda';

/**
 * This is an lambda@edge function that is used to determine the best origin for a request using
 * route53 latency based routing with CNAME records.
 *
 * The handler code is embedded inline below.
 */
export class BestOriginFunction extends Function {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      memorySize: 128,
      code: Code.fromInline(`
const dns = require('dns');

const ttl = 1000 * 60 * 2; // 2 minutes

const cache = {};

function getBestOrigin(host) {
  const now = Date.now();
  const entry = cache[host];
  if (entry && now < entry.expires) return Promise.resolve(entry.bestOrigin);
  return new Promise((resolve) => {
    dns.resolveCname(host, (err, addr) => {
      if (!addr) {
        console.error('No address found for host');
        resolve(null);
      } else {
        cache[host] = {
          bestOrigin: addr[0],
          expires: now + ttl,
        };
        resolve(addr[0]);
      }
    });
  });
}

function internalServerError() {
  return {
    status: '500',
    statusDescription: 'Internal Server Error',
    headers: {
      'content-type': [{key: 'Content-Type', value: 'application/json'}],
    },
    body: JSON.stringify({
      errorMessage: 'Internal Server Error',
    }),
  };
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const origin = request.origin?.custom?.domainName;
  if (!origin) {
    console.error('No origin found on request');
    return internalServerError();
  }

  const bestOrigin = await getBestOrigin(origin);
  if (!bestOrigin) {
    return internalServerError();
  }

  request.headers['host'] = [
    {
      key: 'host',
      value: bestOrigin,
    },
  ];
  request.headers['original-origin'] = [
    {
      key: 'original-origin',
      value: origin,
    },
  ];
  if (request.origin?.custom?.domainName) {
    request.origin.custom.domainName = bestOrigin;
    return request;
  }
  throw new Error('Origin not found on request');
};
`),
    });
  }
}
