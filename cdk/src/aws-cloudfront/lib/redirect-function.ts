import {Function, FunctionCode} from 'aws-cdk-lib/aws-cloudfront';
import {Construct} from 'constructs';
import {DomainName} from '../../aws-route53/index';

export type TrailingSlashBehavior =
  | 'None'
  | 'ForwardToIndex'
  | 'RedirectNoSlash';

export type NoFileIndexBehavior = 'None' | 'ForwardToIndex' | 'RedirectToSlash';

export type RobotsBehavior = 'None' | 'Allow' | 'Disallow';

/**
 * Controls redirecting between the apex domain and the "www" subdomain.
 *
 * - "None" - no redirect is performed.
 * - "RedirectToApex" - requests to "www.example.com" are redirected to "example.com".
 * - "RedirectToWww" - requests to "example.com" are redirected to "www.example.com".
 */
export type WwwRedirectBehavior = 'None' | 'RedirectToApex' | 'RedirectToWww';

export interface RedirectFunctionProps {
  /**
   * Optional domain to redirect to if the host header does not match.
   */
  readonly apexDomain?: string | DomainName;

  /**
   * The default file to request when the URI ends with a '/'. Set to en empty string to disable.
   *
   * @default "index.html"
   */
  readonly indexFile?: string;

  /**
   * Sets the behavior of paths with trailing slashes. Default is "ForwardToIndex".
   *
   * @default "ForwardToIndex"
   */
  readonly trailingSlashBehavior?: TrailingSlashBehavior;

  /**
   * Sets the behavior of paths with no file extension. Default is "None"
   *
   * @default "None"
   */
  readonly noFileExtensionBehavior?: NoFileIndexBehavior;

  /**
   * Sets the behavior for /robots.txt requests. Default is "Allow".
   */
  readonly robotsBehavior?: RobotsBehavior;

  /**
   * Redirects between the apex domain and the "www" subdomain. Default is "None".
   *
   * Note that this is evaluated before `apexDomain`. Generally only one of
   * `wwwRedirectBehavior` or `apexDomain` should be set.
   *
   * @default "None"
   */
  readonly wwwRedirectBehavior?: WwwRedirectBehavior;
}

export class RedirectFunction extends Function {
  constructor(scope: Construct, id: string, props: RedirectFunctionProps) {
    super(scope, id, {
      code: FunctionCode.fromInline(
        `
function handler(event) {
  var host = event.request.headers.host.value;
  var uri = event.request.uri;
  if ("WWW_REDIRECT_BEHAVIOR" === "RedirectToApex" && host.startsWith("www.")) {
    return {
      statusCode: 301,
      statusDescription: "Permanently moved",
      headers: {
        "location": { "value": "https://" + host.substring(4) + uri }
      }
    }
  }
  if ("WWW_REDIRECT_BEHAVIOR" === "RedirectToWww" && !host.startsWith("www.")) {
    return {
      statusCode: 301,
      statusDescription: "Permanently moved",
      headers: {
        "location": { "value": "https://www." + host + uri }
      }
    }
  }
  if ("APEX_DOMAIN" !== "" && host !== "APEX_DOMAIN") {
    return {
      statusCode: 301,
      statusDescription: "Permanently moved",
      headers: {
        "location": { "value": "https://APEX_DOMAIN" + uri }
      }
    }
  }
  if ("INDEX_FILE" !== "" && "NO_FILE_EXTENSION_BEHAVIOR" !== "None" && uri.split("/").pop().split(".").length <= 1) {
    if ("NO_FILE_EXTENSION_BEHAVIOR" === "ForwardToIndex") {
      event.request.uri = uri + "/INDEX_FILE";
    } else {
      return {
        statusCode: 301,
        statusDescription: "Permanently moved",
        headers: {
          "location": { "value": uri + "/" }
        }
      }
    }
  }
  if ("INDEX_FILE" !== "" && "TRAILING_SLASH_BEHAVIOR" !== "None" && uri.endsWith("/")) {
    if ("TRAILING_SLASH_BEHAVIOR" === "ForwardToIndex" || uri === "/") {
      event.request.uri = uri + "INDEX_FILE";
    } else {
      return {
        statusCode: 301,
        statusDescription: "Permanently moved",
        headers: {
          "location": { "value": uri.replace(/.$/, "") }
        }
      }
    }
  }
  if (event.request.uri === "/robots.txt" && "ROBOTS_BEHAVIOR" !== "None") {
    if ("ROBOTS_BEHAVIOR" === "Allow") {
      return {
        statusCode: 200,
        statusDescription: "OK",
        headers: {
         "content-type": { "value": "text/plain" }
        },
        body: "User-agent: *\\nAllow: /"
      }
    } else { // Disallow
      return {
        statusCode: 200,
        statusDescription: "OK",
        headers: {
         "content-type": { "value": "text/plain" }
        },
        body: "User-agent: *\\nDisallow: /"
      }
    }
  }
  return event.request;
}`
          .replace(/APEX_DOMAIN/g, props.apexDomain?.toString() ?? '')
          .replace(/INDEX_FILE/g, props.indexFile ?? 'index.html')
          .replace(
            /NO_FILE_EXTENSION_BEHAVIOR/g,
            props.noFileExtensionBehavior ?? 'None',
          )
          .replace(
            /TRAILING_SLASH_BEHAVIOR/g,
            props.trailingSlashBehavior ?? 'ForwardToIndex',
          )
          .replace(/ROBOTS_BEHAVIOR/g, props.robotsBehavior ?? 'Allow')
          .replace(
            /WWW_REDIRECT_BEHAVIOR/g,
            props.wwwRedirectBehavior ?? 'None',
          ),
      ),
    });
  }
}
