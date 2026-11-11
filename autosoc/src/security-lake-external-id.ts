export function validateSecurityLakeExternalId(
  externalId: string | undefined,
): void {
  if (externalId !== undefined && !/^[0-9A-Za-z]+$/.test(externalId)) {
    throw new Error(
      'Security Lake external id must be alphanumeric only ' +
        '(/^[0-9A-Za-z]+$/) to satisfy the upstream aes-siem ' +
        'SecurityLakeExternalId constraint. Generate one with ' +
        '`openssl rand -hex 16`.',
    );
  }
}
