---
"truemark-cdk-lib": minor
---

Fixed CloudFrontBucketV2 ignoring the bucketName prop. Stacks that set bucketName previously had it silently ignored and an auto-generated name was used. The value now takes effect, so on the next deployment CloudFormation will replace the bucket to apply the new name (the old bucket is retained or deleted per its removal policy, and any existing objects must be migrated).
