---
"truemark-cdk-lib": patch
---

Remove `@aws-sdk/credential-provider-node` peer dependency. The bedrock knowledge base collection index handler now relies on the OpenSearch signer's default credential lookup, which uses the module provided by the Lambda runtime.
