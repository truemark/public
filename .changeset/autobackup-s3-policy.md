---
"truemark-cdk-lib": patch
---

AutoBackup selection roles now carry `AWSBackupServiceRolePolicyForS3Backup`, so S3 buckets tagged with `backup:policy` are backed up instead of failing with a permission error. Buckets must still have versioning enabled for AWS Backup to protect them.
