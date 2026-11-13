---
'truemark-cdk-lib': minor
---

Global secondary indexes on `ExtendedTable`, `ExtendedTableV2`, `StandardTable` and
`StandardTableV2` now get throttle alarms and are no longer added to dashboards by default.

**Behavior change — indexes leave the dashboards.** Each monitored index used to add four
widgets to every dashboard it was on. CloudWatch rejects a dashboard with more than 500 widgets
(`"/widgets" Should NOT have more than 500 items`), so a stack with many tables and indexes
failed to deploy once `ExtendedTableV2` began monitoring indexes in 1.32.0. On upgrade the index
widgets are removed from existing dashboards; the table's own widgets stay. Set the new
`addGlobalSecondaryIndexesToDashboards: true` on a table to keep them:

```ts
new StandardTableV2(this, 'Core', {
  globalSecondaryIndexes: 5,
  addGlobalSecondaryIndexesToDashboards: true,
});
```

**Behavior change — two new alarms per index.** Every index now gets a read-throttle and a
write-throttle alarm, named `<prefix>-<table id>-<index name>-Read-Throttled-Events-Critical`
(and `-Write-`). They use the table's existing `maxReadThrottledEventsCount` and
`maxWriteThrottledEventsCount` thresholds — critical at more than 0 by default — and the same
notification topics and actions as the table's alarms. Expect two additional
`AWS::CloudWatch::Alarm` resources per index on the next deploy, which counts toward the
500-resource limit of a stack. `createAlarms: false` still turns off all monitoring for a table,
its indexes included.

`StandardTableProps` now extends `TableAlarmsOptions`, so `StandardTable` accepts
`addGlobalSecondaryIndexesToDashboards` along with the other alarm options (`createAlarms`,
`criticalAlarmOptions`, `warningAlarmOptions`, the `addTo*Dashboard` flags), as `StandardTableV2`
already did. Previously these were rejected by the type even though the constructor passed them
through.

Also fixed: `StandardTable` registered each index for monitoring twice, which duplicated its
dashboard widgets.
