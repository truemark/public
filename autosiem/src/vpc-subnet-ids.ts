export function validateVpcSubnetIds(subnetIds: string[] | undefined): void {
  if (subnetIds === undefined) return;
  for (const subnetId of subnetIds) {
    if (!/^subnet-[0-9a-f]{8,17}$/.test(subnetId)) {
      throw new Error(
        `AutoSocSiem: invalid VPC subnet id "${subnetId}" ` +
          '(expected /^subnet-[0-9a-f]{8,17}$/) to satisfy the vendored ' +
          "aes-siem template's AosSubnetIds constraint.",
      );
    }
  }
}
