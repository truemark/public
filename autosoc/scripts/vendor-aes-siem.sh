#!/usr/bin/env bash
# Download the pinned upstream aes-siem CloudFormation template into
# autosoc/vendor/aes-siem/ so AutoSocSiemStack can package it as a CDK
# S3 asset instead of referencing a floating upstream URL.
#
# Once vendored, you can edit the template and deploy with
# `AesSiemTemplateSource.VENDORED`. To refresh against upstream, re-run
# this script and diff.
#
# Pin is sourced from AES_SIEM_TEMPLATE_VERSION in
# autosoc/src/autosoc-siem-stack.ts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOSOC_ROOT="$(cd "${HERE}/.." && pwd)"
VENDOR_DIR="${AUTOSOC_ROOT}/vendor/aes-siem"
TEMPLATE_FILE_NAME="${AES_SIEM_TEMPLATE_FILE_NAME:-siem-on-amazon-opensearch-service.template}"
case "${TEMPLATE_FILE_NAME}" in
  siem-on-amazon-opensearch-service.template|siem-on-amazon-opensearch-service-china.template|siem-on-amazon-opensearch-service-usgov.template)
    ;;
  *)
    echo "error: unsupported AES_SIEM_TEMPLATE_FILE_NAME: ${TEMPLATE_FILE_NAME}" >&2
    exit 1
    ;;
esac
TARGET="${VENDOR_DIR}/${TEMPLATE_FILE_NAME}"
METADATA="${TARGET}.UPSTREAM.md"
# Extract the version pinned in TypeScript source so this script never
# drifts from the AES_SIEM_TEMPLATE_VERSION constant.
EXPECTED_VERSION="$(grep -E "AES_SIEM_TEMPLATE_VERSION = '[0-9.]+'" \
  "${AUTOSOC_ROOT}/src/autosoc-siem-stack.ts" \
  | sed -E "s/.*AES_SIEM_TEMPLATE_VERSION = '([0-9.]+)'.*/\1/" \
  | head -1)"
if [[ -z "${EXPECTED_VERSION}" ]]; then
  echo "error: could not locate AES_SIEM_TEMPLATE_VERSION in autosoc-siem-stack.ts" >&2
  exit 1
fi

# Use the exact release tag rather than the mutable per-Region S3 alias.
UPSTREAM_URL="https://raw.githubusercontent.com/aws-samples/siem-on-amazon-opensearch-service/v${EXPECTED_VERSION}/deployment/${TEMPLATE_FILE_NAME}"

mkdir -p "${VENDOR_DIR}"

echo "Fetching ${UPSTREAM_URL}"
if [[ -f "${TARGET}" ]]; then
  cp "${TARGET}" "${TARGET}.previous"
  echo "Previous vendored template backed up to ${TARGET}.previous"
fi
curl --fail --show-error --silent --location \
  "${UPSTREAM_URL}" --output "${TARGET}"

TEMPLATE_VERSION="$(grep -E '^Description: SIEM on Amazon OpenSearch Service' "${TARGET}" | head -1 || true)"
if [[ -z "${TEMPLATE_VERSION}" ]]; then
  echo "error: unable to detect template version from Description header" >&2
  exit 1
fi
echo "Downloaded: ${TEMPLATE_VERSION#Description: }"

# Fail if the downloaded template header does not contain the pinned
# version string. This prevents `vendor:aes-siem` from silently pulling
# a newer upstream release when the AES_SIEM_TEMPLATE_VERSION constant
# has not been bumped in TypeScript.
if ! echo "${TEMPLATE_VERSION}" | grep -q "v${EXPECTED_VERSION}"; then
  echo "" >&2
  echo "error: downloaded template header does not contain pinned version v${EXPECTED_VERSION}" >&2
  echo "  expected: v${EXPECTED_VERSION} (from AES_SIEM_TEMPLATE_VERSION in autosoc-siem-stack.ts)" >&2
  echo "  got:      ${TEMPLATE_VERSION#Description: }" >&2
  echo "" >&2
  echo "Bump AES_SIEM_TEMPLATE_VERSION in autosoc/src/autosoc-siem-stack.ts" >&2
  echo "to a release tag that contains this template, then re-run the script." >&2
  rm -f "${TARGET}"
  [[ -f "${TARGET}.previous" ]] && mv "${TARGET}.previous" "${TARGET}"
  exit 1
fi
echo "Version check passed: template contains v${EXPECTED_VERSION}"

# Track every patch this script applies on top of the raw upstream source
# so the generated .UPSTREAM.md always reflects reality instead of relying
# on that file's provenance notes being kept in sync by hand.
PATCHES=()

# Resolve the %%BUCKET_NAME%% / %%SOLUTION_NAME%% / %%VERSION%% placeholders
# that upstream's own `deployment/build-s3-dist.sh` packaging script would
# normally substitute before publishing a template. The raw GitHub source
# template is never meant to be deployed as-is: every Lambda `Code` block
# still contains these literal placeholder strings, which would make
# CloudFormation try to source Lambda code from a bucket literally named
# `%%BUCKET_NAME%%`.
#
# Upstream's own published (pre-built) per-Region templates — e.g.
# https://aes-siem-us-east-1.s3.us-east-1.amazonaws.com/siem-on-amazon-opensearch-service.template
# — show that `%%BUCKET_NAME%%` always resolves to `aes-siem-<region>` and
# `%%SOLUTION_NAME%%/%%VERSION%%` always resolves to
# `siem-on-amazon-opensearch-service/v<version>` (identical for every
# Region/partition; only the bucket name varies by Region). Rather than
# hardcoding a single Region, substitute `%%BUCKET_NAME%%` with the
# `Fn::Sub`-expanded `aes-siem-${AWS::Region}` so the vendored template
# stays Region-portable like the rest of the template's own `!Sub` usage.
SOLUTION_NAME="siem-on-amazon-opensearch-service"
set +e
python3 - "${TARGET}" "${SOLUTION_NAME}" "${EXPECTED_VERSION}" <<'PY'
import re
import sys

path, solution_name, version = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    text = f.read()

before = text
# S3Bucket: '%%BUCKET_NAME%%'  ->  S3Bucket: !Sub 'aes-siem-${AWS::Region}'
text = text.replace(
    "S3Bucket: '%%BUCKET_NAME%%'",
    "S3Bucket: !Sub 'aes-siem-${AWS::Region}'",
)
# S3Key: '%%SOLUTION_NAME%%/%%VERSION%%/assets/foo.zip'  ->  resolved path
text = re.sub(
    r"%%SOLUTION_NAME%%/%%VERSION%%",
    f"{solution_name}/v{version}",
    text,
)
if "%%BUCKET_NAME%%" in text or "%%VERSION%%" in text or "%%SOLUTION_NAME%%" in text:
    sys.exit("error: unresolved %%...%% placeholder(s) remain after substitution")
if text == before:
    print("warning: no %%...%% placeholders found to substitute (already resolved?)")
    sys.exit(2)
with open(path, "w") as f:
    f.write(text)
PY
PLACEHOLDER_STATUS=$?
set -e
if [[ "${PLACEHOLDER_STATUS}" -eq 0 ]]; then
  echo "Resolved %%BUCKET_NAME%%/%%SOLUTION_NAME%%/%%VERSION%% placeholders"
  PATCHES+=("Resolves the Lambda code bucket and solution/version build placeholders (\`%%BUCKET_NAME%%\` -> \`!Sub 'aes-siem-\${AWS::Region}'\`, \`%%SOLUTION_NAME%%/%%VERSION%%\` -> \`${SOLUTION_NAME}/v${EXPECTED_VERSION}\`).")
elif [[ "${PLACEHOLDER_STATUS}" -eq 2 ]]; then
  echo "No %%...%% placeholders found to substitute (already resolved?)"
else
  exit "${PLACEHOLDER_STATUS}"
fi

# Patch NoEcho onto the GeoLite2LicenseKey / OtxApiKey parameters.
# Upstream does not mark these secret-ish parameters NoEcho, so without
# this patch the values remain visible via DescribeStacks on the nested
# stack regardless of how the parent CDK stack passes them in. Only
# insert the line if it is not already present directly beneath the
# parameter's `MaxLength:` line, so repeated re-vendors stay idempotent.
for PARAM in GeoLite2LicenseKey OtxApiKey; do
  if grep -A6 "^  ${PARAM}:" "${TARGET}" | grep -q 'NoEcho: true'; then
    continue
  fi
  # Insert `NoEcho: true` right after the parameter's MaxLength line,
  # matched only within that parameter's own 6-line block so we never
  # touch an unrelated parameter that happens to share a MaxLength value.
  python3 - "${TARGET}" "${PARAM}" <<'PY'
import sys
path, param = sys.argv[1], sys.argv[2]
with open(path) as f:
    lines = f.readlines()
out = []
in_block = False
patched = False
for i, line in enumerate(lines):
    out.append(line)
    if line.strip() == f"{param}:":
        in_block = True
        continue
    if in_block and line.strip().startswith("MaxLength:"):
        out.append("    NoEcho: true\n")
        in_block = False
        patched = True
    elif in_block and line.startswith("  ") and not line.startswith("    "):
        # Reached the next top-level parameter without seeing MaxLength;
        # stop looking (nothing to patch for this occurrence).
        in_block = False
if not patched:
    sys.exit(f"error: could not find MaxLength line under {param}: to patch NoEcho")
with open(path, "w") as f:
    f.writelines(out)
PY
  echo "Patched NoEcho: true onto ${PARAM}"
  PATCHES+=("Adds \`NoEcho: true\` to \`${PARAM}\`.")
done

{
  echo "# Vendored aes-siem template"
  echo ""
  echo "- Upstream URL: \`${UPSTREAM_URL}\`"
  echo "- Release: \`v${EXPECTED_VERSION}\`"
  echo "- File: \`${TEMPLATE_FILE_NAME}\`"
  echo "- Fetched: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "- Template header: \`${TEMPLATE_VERSION#Description: }\`"
  echo ""
  if [[ ${#PATCHES[@]} -gt 0 ]]; then
    echo "**Patches applied by \`vendor-aes-siem.sh\` on top of the raw GitHub source:**"
    for p in "${PATCHES[@]}"; do
      echo "- ${p}"
    done
    echo ""
  fi
  echo "**Do not edit \`${TEMPLATE_FILE_NAME}\` by hand without recording the diff here** so"
  echo "future refreshes can be reconciled against upstream."
  echo ""
  echo "To refresh, run \`pnpm run vendor:aes-siem\` from \`autosoc/\`; it fetches"
  echo "the exact tag recorded above. Previous copies are kept beside the template"
  echo "with a \`.previous\` suffix for diffing."
} > "${METADATA}"

if [[ -f "${TARGET}.previous" ]]; then
  echo ""
  echo "Diff vs previous vendored copy (first 50 lines):"
  diff -u "${TARGET}.previous" "${TARGET}" | head -50 || true
fi

echo ""
echo "Done. To use the vendored template, pass"
echo "  -c siemTemplateSource=vendored"
echo "to CDK (upstream is the default; vendored is opt-in)."
