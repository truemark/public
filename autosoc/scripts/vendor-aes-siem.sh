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

cat > "${METADATA}" <<EOF
# Vendored aes-siem template

- Upstream URL: \`${UPSTREAM_URL}\`
- Release: \`v${EXPECTED_VERSION}\`
- File: \`${TEMPLATE_FILE_NAME}\`
- Fetched: $(date -u +'%Y-%m-%dT%H:%M:%SZ')
- Template header: \`${TEMPLATE_VERSION#Description: }\`

**Do not edit \`${TEMPLATE_FILE_NAME}\` by hand without recording the diff here** so
future refreshes can be reconciled against upstream.

To refresh, run \`pnpm run vendor:aes-siem\` from \`autosoc/\`; it fetches
the exact tag recorded above. Previous copies are kept beside the template
with a \`.previous\` suffix for diffing.
EOF

if [[ -f "${TARGET}.previous" ]]; then
  echo ""
  echo "Diff vs previous vendored copy (first 50 lines):"
  diff -u "${TARGET}.previous" "${TARGET}" | head -50 || true
fi

echo ""
echo "Done. To use the vendored template, pass"
echo "  -c siemTemplateSource=vendored"
echo "to CDK (the vendored source is the default)."
