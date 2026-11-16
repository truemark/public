export function validateLakeFormationDataLakeAdmins(
  adminArns: string[] | undefined,
): void {
  if (adminArns === undefined) return;
  for (const arn of adminArns) {
    if (!/^arn:aws[a-zA-Z-]*:iam::\d{12}:(role|user)\/.+$/.test(arn)) {
      throw new Error(
        `AutoSocSecurityLake: invalid Lake Formation admin principal "${arn}" ` +
          '(expected an IAM role or user ARN, e.g. ' +
          'arn:aws:iam::123456789012:role/Example).',
      );
    }
  }
}
