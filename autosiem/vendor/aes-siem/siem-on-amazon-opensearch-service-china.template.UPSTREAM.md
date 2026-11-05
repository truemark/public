# Vendored aes-siem template

- Upstream URL: `https://raw.githubusercontent.com/aws-samples/siem-on-amazon-opensearch-service/v2.10.6/deployment/siem-on-amazon-opensearch-service-china.template`
- Release: `v2.10.6`
- File: `siem-on-amazon-opensearch-service-china.template`
- Fetched: 2026-11-04T17:02:40Z
- Template header: `SIEM on Amazon OpenSearch Service v2.10.6`

**Patches applied by `vendor-aes-siem.sh` on top of the raw GitHub source:**
- Resolves the Lambda code bucket and solution/version build placeholders (`%%BUCKET_NAME%%` -> `!Sub 'aes-siem-${AWS::Region}'`, `%%SOLUTION_NAME%%/%%VERSION%%` -> `siem-on-amazon-opensearch-service/v2.10.6`).
- Adds `NoEcho: true` to `GeoLite2LicenseKey`.
- Adds `NoEcho: true` to `OtxApiKey`.
- Adds an `AosSubnetIds` parameter (and `HasAosSubnetIds` condition, OR'd into `IsInVpc`) so the OpenSearch domain and es-loader can be placed directly into an existing VPC's subnets without requiring a pre-existing OpenSearch domain to anchor `VpcEndpointId`. Wires `AOS_SUBNET_IDS`/`AOS_SECURITY_GROUP_ID` (reusing `AesSiemVpcSecurityGroup2nd`) into the resource-validator and domain-deployment Lambdas, reproducing upstream's own native-CDK `vpc_type=import` behavior (source/cdk/mysiem/aos_deployment.py) on top of the vendored template instead.

**Do not edit `siem-on-amazon-opensearch-service-china.template` by hand without recording the diff here** so
future refreshes can be reconciled against upstream.

To refresh, run `pnpm run vendor:aes-siem` from `autosiem/`; it fetches
the exact tag recorded above. Previous copies are kept beside the template
with a `.previous` suffix for diffing.
