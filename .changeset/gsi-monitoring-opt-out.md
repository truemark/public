---
'truemark-cdk-lib': minor
---

Add `monitorGlobalSecondaryIndexes` to `TableAlarmsOptions`, so a table can keep its own
monitoring and alarms while leaving its global secondary indexes off the dashboards.

The option is accepted by `ExtendedTable`, `ExtendedTableV2`, `StandardTable` and
`StandardTableV2`. It defaults to `true`, so nothing changes unless you set it.

Why you might need it: since 1.32.0, `ExtendedTableV2` and `StandardTableV2` monitor every
global secondary index, as `ExtendedTable` always did. Each monitored index adds four widgets to
every dashboard it is on, and CloudWatch rejects a dashboard with more than 500 widgets
(`"/widgets" Should NOT have more than 500 items`), which fails the stack deploy. A stack with
many tables and indexes can cross that limit on upgrade without any change of its own. Set
`monitorGlobalSecondaryIndexes: false` on its tables to return to table-level widgets:

```ts
new StandardTableV2(this, 'Core', {
  globalSecondaryIndexes: 5,
  monitorGlobalSecondaryIndexes: false,
});
```
