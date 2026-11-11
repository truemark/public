---
'truemark-cdk-lib': minor
---

Give the S3 and DynamoDB VPC gateway endpoints created by `StandardNetwork` their own
`Name` tags, `<name>-s3` and `<name>-dynamodb`, so the two are distinguishable in the
console and in tag-based queries.

Both endpoints previously inherited the VPC's `Name` tag, so they were each labeled
`<name>`. This changes those existing tag values rather than adding a tag where none
was present: anything keyed on `Name = <name>` for these two endpoints — cost
allocation, resource groups, tag-condition IAM policies — will need updating. The
endpoints' logical IDs are unchanged, so CloudFormation applies this as an in-place
tag update with no resource replacement.
