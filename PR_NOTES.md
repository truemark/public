# NAT Instance Implementation - PR Notes

## Breaking Changes

### ⚠️ azCount default changed from 2 to 3

**Impact**: Existing consumers of `StandardNetwork` who rely on the default `azCount` will see additional resources created:
- Additional subnets in a third availability zone
- Higher monthly costs due to additional NAT resources (if using NAT Gateway)
- Different CIDR allocations

**Rationale**: Aligns with AWS best practices for high availability and fault tolerance. Three availability zones provide better resilience than two.

**Migration**: Existing consumers who want to maintain current behavior should explicitly set `azCount: 2` in their StandardNetwork configuration.

```typescript
new StandardNetwork(stack, 'Network', {
  name: 'MyNetwork',
  vpcCidr: '10.0.0.0/16',
  azCount: 2, // Explicitly set to maintain previous default
  // ... other options
});
```

## New Features

### NAT Instance Support

Added `nat_instance` as a new `natType` option for cost-effective NAT in non-production environments:
- Auto Scaling Group with single NAT instance (t4g.micro by default)
- Automatic ENI attachment for persistent private IP
- Route table management for private subnet egress
- Instance self-termination on unrecoverable failures
- IAM permissions scoped per-stack with unique tags

**Usage**:
```typescript
new StandardNetwork(stack, 'Network', {
  name: 'DevNetwork',
  vpcCidr: '10.0.0.0/16',
  natType: 'nat_instance', // New option
});
```

**Cost savings**: ~$32/month vs ~$96/month for NAT Gateway (3 AZs)

**Limitations**: 
- Single point of failure (all AZs route through one NAT)
- Lower throughput than NAT Gateway
- Cross-AZ data charges for traffic from other AZs

## Technical Details

- Fixed critical boot failure with SourceDestCheck command format
- Fixed cross-stack IAM isolation with unique per-stack tags
- Added comprehensive test coverage
- Corrected vpc.privateSubnets documentation
