---
'truemark-cdk-lib': minor
---

- aws-cloudwatch: `ExtendedAlarm` now sends `okActions` to the alarm's OK actions and
  `insufficientDataActions` to its insufficient-data actions. Both were added to the alarm
  actions, so they fired when the alarm went into ALARM and never on OK or INSUFFICIENT_DATA.
  This also applies to `EstimatedChargesAlarm`, which passes its props to `ExtendedAlarm`.
  Behaviour change on deploy for any alarm built with `okActions` or
  `insufficientDataActions`: CloudFormation moves those ARNs from `AlarmActions` to
  `OKActions` / `InsufficientDataActions` in place (no replacement), so those targets stop
  receiving ALARM notifications and start receiving the ones they were meant for. Alarms
  built only with `alarmActions` or the `*Topics` props are unchanged.
- aws-sqs: `StandardQueue` takes an optional `contentBasedDeduplication`, for FIFO queues
  whose producers do not send a deduplication ID. It is applied to the queue, not its dead
  letter queue, and the constructor throws unless `fifo: true` is also set. Consumers
  setting it through a `CfnQueue` escape hatch can drop the escape hatch; the template is
  the same.
- aws-sqs: a `StandardQueue` with a dead letter queue carries two alarms on the dead letter
  queue's visible messages: the `StandardDeadLetterQueue` alarm (>= 1 over one 5-minute
  period, unnamed, no actions) and the `QueueAlarms` critical alarm
  (`<prefix>-DLQ-Queue-Message-Count-Max-Critical`, `deadLetterQueueMaxSize`, sent to the
  `criticalAlarmOptions` topics and actions). The new `createDeadLetterQueueAlarm: false`
  keeps only the `QueueAlarms` one. The default is unchanged (both alarms), so upgrading
  changes no template; opting in deletes the dead letter queue's own alarm (logical ID
  `<id>DlqAlarm…`) and nothing else. If you also set `createAlarms: false` or
  `deadLetterQueueMaxSize: -1`, nothing alarms on the dead letter queue.
- aws-sqs: `StandardDeadLetterQueue` takes an optional `createAlarm` (default `true`).
  With `createAlarm: false` it creates no alarm and reading `alarm` throws. `alarm` is
  still typed `Alarm`.
