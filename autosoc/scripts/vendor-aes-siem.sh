#!/usr/bin/env bash
# Download the pinned upstream aes-siem CloudFormation template into
# autosoc/vendor/aes-siem/ so AutoSocSiemStack can package it as a CDK
# S3 asset instead of referencing the upstream public bucket.
#
# Once vendored, you can edit siem.yaml and deploy with
# `AesSiemTemplateSource.VENDORED`. To refresh against upstream, re-run
# this script and diff.
#
# Pin is sourced from AES_SIEM_TEMPLATE_VERSION in
# autosoc/src/autosoc-siem-stack.ts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOSOC_ROOT="$(cd "${HERE}/.." && pwd)"
VENDOR_DIR="${AUTOSOC_ROOT}/vendor/aes-siem"
TARGET="${VENDOR_DIR}/siem.yaml"
UPSTREAM_URL="${AES_SIEM_UPSTREAM_URL:-https://aes-siem-us-east-1.s3.amazonaws.com/siem-on-amazon-opensearch-service.template}"

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
  echo "warning: unable to detect template version from Description header"
else
  echo "Downloaded: ${TEMPLATE_VERSION#Description: }"
fi

cat > "${VENDOR_DIR}/UPSTREAM.md" <<EOF
# Vendored aes-siem template

- Upstream URL: \`${UPSTREAM_URL}\`
- Fetched: $(date -u +'%Y-%m-%dT%H:%M:%SZ')
- Template header: \`${TEMPLATE_VERSION#Description: }\`

**Do not edit \`siem.yaml\` by hand without recording the diff here** so
future refreshes can be reconciled against upstream.

To refresh, run \`pnpm run vendor:aes-siem\` from \`autosoc/\`.
Previous vendored copy is kept in \`siem.yaml.previous\` for diffing.
EOF

if [[ -f "${TARGET}.previous" ]]; then
  echo ""
  echo "Diff vs previous vendored copy (first 50 lines):"
  diff -u "${TARGET}.previous" "${TARGET}" | head -50 || true
fi

echo ""
echo "Done. To use the vendored template, pass"
echo "  templateSource: AesSiemTemplateSource.VENDORED"
echo "to AutoSocSiemStack (or set -c siemTemplateSource=vendored)."
