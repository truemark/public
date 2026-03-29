# AutoBackup

Configures AWS backup to automatically backup resources based on tags.

## Supported Tags

| Tag           | Description                       |
| ------------- | --------------------------------- |
| backup:policy | Name of the backup policy to use. |

## Backup Policies

| Policy          | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| default-7-years | 35 days of daily, 90 days of weekly and 2555 days of monthly |
| default-year    | 35 days of daily, 90 days of weekly, 365 days of monthly     |
| default-quarter | 35 days of daily, 90 days of weekly                          |
| default-month   | 35 days of daily                                             |
| default-week    | 7 days of of daily                                           |

## How to deploy

If not already done, bootstrap the account for CDK

```bash
cdk bootstrap \
"aws://$(aws sts get-caller-identity --query 'Account' --output text)/${AWS_DEFAULT_REGION}" \
--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

Deploy the stack

```bash
cdk deploy
```
