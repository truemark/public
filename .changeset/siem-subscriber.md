---
'truemark-cdk-lib': minor
---

aws-securitylake: `StandardSecurityLake` now supports a `subscribers` prop
that creates `AWS::SecurityLake::Subscriber` (access type `S3`) plus
`AWS::SecurityLake::SubscriberNotification` resources. SQS notification is
the default; HTTPS notification is supported via `httpsNotificationEndpoint`.
Exposed as `SecurityLakeSubscriberProps` / `SecurityLakeSubscriberSourceProps`
with `subscribers` and `subscriberNotifications` arrays on the construct for
downstream wiring.
