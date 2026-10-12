---
"truemark-cdk-lib": minor
---

aws-securitylake: add StandardSecurityLake construct that wraps the Security Lake L1 constructs to stand up a data lake. Supports an optional `createLakeFormationServiceLinkedRole` flag to provision the `AWSServiceRoleForLakeFormationDataAccess` SLR required by Security Lake.
