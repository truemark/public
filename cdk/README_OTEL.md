## TrueMark CDK Library Open Telemetry (OTEL) Support

### Which CDK construct to use for OTEL support?

- Extend the TrueMark Standard Application Fargate Service
  The `StandardApplicationFargateService` has all the functionality set for open telemetry including creation of the associated Grafana dashboard. There is a property `otel` in this service to setup OTEL and it appears as below:

```typescript
/**
* Setting the Standard OpenTelemetry (OTEL) configuration for ECS services.
*
*/
readonly otel?: OtelConfig;
```

- Use of the SSM parameter or the configuration file
    1. Example enabling otel pointing to an aws ssm parameter:

    ```typescript
    otel: {
        enabled: true,
        ssmConfigContentParam: context.otelSsmConfigContentParam,
    },
    ```

    Where `context.otelSsmConfigContentParam` is the ssm parameter name in aws. 2. Using your own otel collector configuration file

          The code should look like the below example:

          ```typescript
              otel: {
                  enabled: true,
                  configPath: './resources/collector-ecs.yaml',
              },
          ```

          When using your own otel collector configuration file, it must have the health check endpoints like the below example:

    ```yaml
    extensions:
        health_check:
            endpoint: 0.0.0.0:13133
            check_collector_pipeline:
                enabled: true
                interval: 5m
                exporter_failure_threshold: 5

    # Other items here

    service:
        # Other ones here
        extensions: [health_check]
    ```
