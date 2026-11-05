---
'truemark-cdk-lib': minor
---

Add NAT instance and IPv6 support to `aws-vpc` (#483).

- **New `NatInstance` construct** — a self-managed, ASG-backed NAT instance with a dedicated
  ENI, offered as a lower-cost alternative to a managed NAT Gateway. Defaults to ARM64 on
  `t4g.micro` (`t3a.micro` on X86_64), with optional spot instances (`useSpotInstance`),
  a custom `imageId`, extra cloud-init files/commands (`additionalWriteFiles`,
  `additionalRunCmds`), and a configurable `ssmPolicyArn`. Exported from `aws-vpc`.
- **`NatType` gains `'natInstance'`** — `StandardNetwork` provisions a `NatInstance` and points
  the private subnet route tables at its ENI when selected. Requires at least one public subnet
  and one private subnet; both are validated.
- **New `enableIpv6` prop on `StandardNetwork`** — associates an Amazon-provided IPv6 CIDR and
  configures the VPC for dual-stack (`ec2.IpProtocol.DUAL_STACK`). IPv6-only mode is not yet
  supported.
- **Migration note for older versions:** `StandardNetwork` defaults to 3 availability zones
  (already the default in `1.29.0`). Consumers upgrading from a version that defaulted to 2
  may get new per-AZ resources **and replacements of existing subnets**: adding a third private
  subnet shifts sequential CIDR allocations in the public and later subnet groups.
  Set `azCount: 2` before upgrading to retain the two-AZ setting; otherwise review `cdk diff`
  and plan the subnet/resource migration.
