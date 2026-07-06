---
"truemark-cdk-lib": minor
---

Fixed CloudFrontBucketV2 ignoring the bucketName prop. This is a breaking change: stacks that set bucketName previously had it silently ignored (an auto-generated name was used), so the bucket will now be renamed to the provided value on the next deployment.
