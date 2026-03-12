# WebAclBuilder Guide

A fluent API builder for creating AWS WAFv2 Web ACLs with intelligent defaults and easy customization.

---

## Quick Start

### Simplest Usage (All Defaults)

```typescript
import {WebAclBuilder} from '@truemark/cdk/aws-wafv2';

const builder = new WebAclBuilder(this, 'MyWebAcl', 'CLOUDFRONT');
builder.name('MyCloudFrontWebACL');
const webAcl = builder.toWebAcl();
```

This automatically includes **7 security rules**:

✅ **AWS Managed Rules (4)**
- Common Rule Set
- Known Bad Inputs  
- Anonymous IP List
- IP Reputation List

✅ **Rate Limiting (2)**
- `RateLimit-AllEndpoints` - 100 requests per 5min from any IP (COUNT mode)
- `RateLimit-SpecificEndpoint` - 20 requests per 5min to `/api/login` (BLOCK mode)

✅ **Geo-Blocking (1)**
- `GeoBlock-HighRiskCountries` - Monitors CN, RU, KP (COUNT mode)

---

## Customization

### Change Specific Endpoint Path
```typescript
builder.rateLimitConfig({
  specificEndpointPath: '/auth/', // Change from /api/login
});
```

### Adjust Rate Limits
```typescript
builder.rateLimitConfig({
  allEndpointsLimit: 200,         // Increase global limit
  specificEndpointLimit: 10,      // Stricter for sensitive endpoint
  specificEndpointPath: '/admin/',
});
```

### Customize Geo-Blocking
```typescript
builder.geoBlockingConfig(['CN', 'RU', 'KP', 'IR', 'SY']); // Add more countries
```

### Disable Specific Rules
```typescript
builder
  .defaultManagedRules({
    commonRuleSet: true,
    knownBadInputs: true,
    anonymousIpList: false,    // Disable
    ipReputationList: true,
  })
  .defaultCustomRules({
    allEndpointsRateLimit: true,
    specificEndpointRateLimit: false, // Disable
    geoBlocking: true,
  });
```

### Start from Scratch
```typescript
builder
  .noDefaultRules() // Disable all defaults
  .addCommonRuleSet()
  .addSqlInjectionRuleSet();
```

---

## Complete API Reference

### Configuration Methods

| Method | Description | Default |
|--------|-------------|---------|
| `.name(string)` | Set WebACL name | Auto-generated |
| `.description(string)` | Set description | - |
| `.defaultAllow()` | Set default action to allow | ✅ |
| `.defaultBlock()` | Set default action to block | - |
| `.managedRuleGroupsMode(mode)` | `'count'` or `'active'` | `'count'` |
| `.rateLimitConfig(options)` | Configure rate limits | See below |
| `.geoBlockingConfig(countries)` | Configure countries | `['CN','RU','KP']` |
| `.defaultManagedRules(options)` | Enable/disable AWS rules | All enabled |
| `.defaultCustomRules(options)` | Enable/disable custom rules | All enabled |
| `.noDefaultRules()` | Disable all defaults | - |
| `.logRetention(days)` | Set log retention | 1 year |
| `.enableLogging(boolean)` | Enable/disable logging | `true` |

### Rate Limit Config Options

```typescript
.rateLimitConfig({
  allEndpointsLimit: 100,           // Requests per 5min (global)
  specificEndpointLimit: 20,        // Requests per 5min (endpoint)
  specificEndpointPath: '/api/login' // Path to protect
})
```

### AWS Managed Rule Sets

| Method | Description |
|--------|-------------|
| `.addCommonRuleSet()` | OWASP Top 10 protections |
| `.addKnownBadInputsRuleSet()` | Known attack patterns |
| `.addAnonymousIpList()` | Anonymous IPs (VPN, Tor) |
| `.addIpReputationList()` | Known malicious IPs |
| `.addSqlInjectionRuleSet()` | SQL injection protection |
| `.addLinuxRuleSet()` | Linux-specific attacks |
| `.addUnixRuleSet()` | Unix-specific attacks |
| `.addWindowsRuleSet()` | Windows-specific attacks |
| `.addPhpRuleSet()` | PHP application protection |
| `.addWordPressRuleSet()` | WordPress protection |

---

## Usage Examples

### Basic with Custom Endpoint
```typescript
const builder = new WebAclBuilder(this, 'WebAcl', 'CLOUDFRONT');
builder
  .name('MyWebACL')
  .rateLimitConfig({
    specificEndpointPath: '/admin/', // Protect admin instead of /api/login
  });
const webAcl = builder.toWebAcl();
```

### WordPress Site
```typescript
const builder = new WebAclBuilder(this, 'WordPressWebAcl', 'REGIONAL');
builder
  .name('WordPressWebACL')
  .rateLimitConfig({
    specificEndpointPath: '/wp-admin/',
    specificEndpointLimit: 10,
  })
  .addPhpRuleSet()
  .addWordPressRuleSet();
const webAcl = builder.toWebAcl();
```

### API Gateway
```typescript
const builder = new WebAclBuilder(this, 'ApiWebAcl', 'REGIONAL');
builder
  .name('ApiWebACL')
  .rateLimitConfig({
    allEndpointsLimit: 500,
    specificEndpointLimit: 5,
    specificEndpointPath: '/api/auth/',
  })
  .addSqlInjectionRuleSet();
const webAcl = builder.toWebAcl();
```

### Minimal (Only AWS Managed Rules)
```typescript
const builder = new WebAclBuilder(this, 'MinimalWebAcl', 'CLOUDFRONT');
builder
  .name('MinimalWebACL')
  .noDefaultCustomRules(); // Keep AWS rules, remove rate limiting & geo-blocking
const webAcl = builder.toWebAcl();
```

### Production Mode (Active Blocking)
```typescript
const builder = new WebAclBuilder(this, 'ProdWebAcl', 'CLOUDFRONT');
builder
  .name('ProductionWebACL')
  .managedRuleGroupsMode('active'); // Block instead of count
const webAcl = builder.toWebAcl();
```

---

## Testing

### Local Unit Tests (No AWS Required)
```bash
cd cdk
pnpm test web-acl-builder.test
```

### Preview CloudFormation Template
```bash
cd cdk/examples
npx cdk synth WebAclBuilderTestStack -a "npx ts-node test-web-acl-builder-direct.ts"
```

### Deploy to AWS
```bash
cd cdk/examples
npx cdk deploy WebAclBuilderTestStack -a "npx ts-node test-web-acl-builder-direct.ts"
```

### Clean Up
```bash
cd cdk/examples
npx cdk destroy WebAclBuilderTestStack -a "npx ts-node test-web-acl-builder-direct.ts"
```

---

## Rule Naming Convention

Rules follow a clear naming pattern for easy identification:

- **`RateLimit-AllEndpoints`** - Applies to ALL traffic
- **`RateLimit-SpecificEndpoint`** - Applies ONLY to configured path
- **`GeoBlock-HighRiskCountries`** - Geo-blocking for specified countries
- **`AWS-AWSManagedRules*`** - AWS managed rule groups

---

## Scopes

### CLOUDFRONT Scope
- **Must** be deployed to `us-east-1`
- Use with CloudFront distributions
- Global coverage

```typescript
new WebAclBuilder(this, 'WebAcl', 'CLOUDFRONT')
```

### REGIONAL Scope
- Can be deployed to any region
- Use with ALB, API Gateway, AppSync, etc.
- Regional coverage

```typescript
new WebAclBuilder(this, 'WebAcl', 'REGIONAL')
```

---

## Best Practices

1. **Start with defaults** - Use the default configuration for immediate protection
2. **Test in COUNT mode** - Use `managedRuleGroupsMode('count')` initially to monitor without blocking
3. **Customize gradually** - Adjust thresholds based on your traffic patterns
4. **Enable active mode** - Switch to `managedRuleGroupsMode('active')` when confident
5. **Monitor metrics** - Use CloudWatch to track rule matches and adjust as needed

---

## Default Values

| Setting | Default Value | Description |
|---------|--------------|-------------|
| All Endpoints Rate Limit | 100 req/5min | Global rate limiting |
| Specific Endpoint Rate Limit | 20 req/5min | Endpoint-specific limit |
| Specific Endpoint Path | `/api/login` | Protected path |
| Geo-Block Countries | CN, RU, KP | High-risk countries |
| Managed Rules Mode | `count` | Safe testing mode |
| Logging | Enabled | 1 year retention |

---

## Files Reference

- **Source Code**: `cdk/src/aws-wafv2/lib/web-acl-builder.ts`
- **Unit Tests**: `cdk/src/aws-wafv2/lib/web-acl-builder.test.ts` (11 tests)
- **Example**: `cdk/examples/test-web-acl-builder-direct.ts`
- **This Guide**: `cdk/examples/WEB_ACL_BUILDER_GUIDE.md`

---

## CloudFormation Resources Created

- `AWS::WAFv2::WebACL` - The Web ACL
- `AWS::Logs::LogGroup` - CloudWatch log group (if logging enabled)
- `AWS::WAFv2::LoggingConfiguration` - WAF logging config (if logging enabled)

---

## Cost Estimation

- WebACL: ~$5/month
- Each Rule: ~$1/month (7 default rules = ~$7/month)
- Requests: ~$0.60 per million requests
- **Total for basic setup**: ~$12/month + request costs

---

## Support

For issues or questions, see:
- AWS WAFv2 Documentation: https://docs.aws.amazon.com/waf/
- CDK Documentation: https://docs.aws.amazon.com/cdk/
