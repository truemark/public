# Vendored aes-siem template

- Upstream URL: `https://raw.githubusercontent.com/aws-samples/siem-on-amazon-opensearch-service/v2.10.6/deployment/siem-on-amazon-opensearch-service-china.template`
- Release: `v2.10.6`
- File: `siem-on-amazon-opensearch-service-china.template`
- Fetched: 2026-10-13T13:16:17Z
- Template header: `SIEM on Amazon OpenSearch Service v2.10.6`

**Do not edit `siem-on-amazon-opensearch-service-china.template` by hand without recording the diff here** so
future refreshes can be reconciled against upstream.

**Patches applied by `vendor-aes-siem.sh` on top of the raw GitHub source:**
- `NoEcho: true` added to `GeoLite2LicenseKey` / `OtxApiKey` (upstream does
  not mark these secret-ish parameters `NoEcho`).
- `%%BUCKET_NAME%%` -> `!Sub 'aes-siem-${AWS::Region}'` and
  `%%SOLUTION_NAME%%/%%VERSION%%` -> `siem-on-amazon-opensearch-service/v2.10.6`
  in every Lambda `Code` block. The raw GitHub source template ships with
  these literal build placeholders unresolved; upstream's own
  `deployment/build-s3-dist.sh` packaging script normally substitutes them
  before publishing a deployable template (confirmed by diffing against
  upstream's own published per-Region templates, e.g.
  `https://aes-siem-us-east-1.s3.us-east-1.amazonaws.com/siem-on-amazon-opensearch-service.template`,
  where `%%BUCKET_NAME%%` always resolves to `aes-siem-<region>`).

To refresh, run `pnpm run vendor:aes-siem` from `autosoc/`; it fetches
the exact tag recorded above. Previous copies are kept beside the template
with a `.previous` suffix for diffing.
