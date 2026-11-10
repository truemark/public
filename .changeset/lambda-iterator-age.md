---
"truemark-cdk-lib": minor
---

aws-lambda: `FunctionAlarms` takes an optional `isIterator` prop, marking a function as a
stream consumer (e.g. a DynamoDB or Kinesis stream). It is forwarded to
cdk-monitoring-constructs, where it controls the iterator-age dashboard widget and gates
`maxIteratorAge` alarms. Unset keeps today's behaviour: the prop is passed through
undefined, so the cdk-monitoring-constructs default of `true` still applies and existing
`maxIteratorAge` alarms and dashboards are unchanged. Pass `isIterator: false` on a
non-stream function to drop the iterator-age widget.
