## Deployment Process

### Prerequisites

#### **Before you begin, ensure you have the following:**

- **AWS CLI**: Installed and configured with appropriate access to your AWS account.
- **AWS CDK**
- **Node.js**: Version 22.x+.
- **Git**
- **pnpm**: Version 9.1.4 or later.

#### **To set up and deploy the AutoAlarm project, follow these steps:**

- **Clone the Repository**

Start by cloning the project repository to your local machine:

```bash
git clone https://github.com/truemark/autoalarm.git
cd autoalarm
```

- **Install Dependencies**

    ```bash
    pnpm install
    ```

- **Configure Region**

    ```bash
    export AWS_REGION=<region>
    ```

- **Configure Keys and Session Token**

    ```bash
    export AWS_ACCESS_KEY_ID="<access-key-id>"
    export AWS_SECRET_ACCESS_KEY="<secret-access-key>"
    export AWS_SESSION_TOKEN="<aws-session-token>"
    ```

- **Bootstrap the CDK**

    ```bash
    cdk bootstrap
    ```

- **Build the Project**

    ```bash
    pnpm build
    ```

- **Deploy the Stack**

    ```bash
    cd cdk ; cdk deploy AutoAlarm
    ```

### Optional: Cost Center and Team Tags

AutoAlarm always applies TrueMark automation tags. You may optionally apply cost center and team tags to all
resources in the stack. No values are hardcoded; tags are only applied when you supply them via environment
variables or CDK context at deploy time:

| Knob        | Environment variable    | CDK context         |
| ----------- | ----------------------- | ------------------- |
| Cost center | `AUTOALARM_COST_CENTER` | `-c costCenter=...` |
| Team        | `AUTOALARM_TEAM`        | `-c team=...`       |

Environment variables take precedence over context values. Example:

```bash
export AUTOALARM_COST_CENTER="platform-engineering"
export AUTOALARM_TEAM="sre"
cdk deploy AutoAlarm
# or equivalently
cdk deploy AutoAlarm -c costCenter=platform-engineering -c team=sre
```

### Considerations

- **CloudFront**: CloudFront is a global service. Its CloudTrail and tag-change events are delivered only in the `us-east-1` region. To use AutoAlarm's CloudFront alarm automation, deploy the stack (or a satellite event rule that forwards CloudFront events to it) in `us-east-1`.
