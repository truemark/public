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
- **BREAKING (default change): `StandardNetwork`'s `azCount` default moves from 2 to 3**, to
  align with AWS high-availability guidance. `StandardNetwork` shipped in 1.24.0, so existing
  consumers who do not set `azCount` explicitly will see a third set of subnets and per-AZ
  resources (NAT gateways, route tables) created on the next deploy. Pin `azCount: 2` to keep
  the previous topology.
