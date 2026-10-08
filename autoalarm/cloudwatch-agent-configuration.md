# Installing and Configuring AWS CloudWatch Agent Using AWS SSM

This guide provides step-by-step instructions on how to install and configure the AWS CloudWatch Agent on EC2 instances using AWS Systems Manager (SSM). This method allows for easy deployment and management of the CloudWatch Agent across multiple instances without the need for manual SSH access to each instance.

## Prerequisites

- **AWS Account**: Ensure you have an AWS account.
- **EC2 Instance(s)**: Running Amazon Linux 2 or other supported OS.
- **IAM Role**: An IAM role for EC2 with permissions to access Systems Manager and CloudWatch.
- **AWS CLI**: Optionally, the AWS CLI installed on your local machine for running commands.
- **SSM Parameter Configuration**: Create SSM parameter with cloudwatch agent configuration for Windows and Linux instances.

## Step 1: Attach IAM Role to EC2 Instances

Ensure that your EC2 instances have an IAM role with the necessary permissions to interact with Systems Manager and CloudWatch. Create a role with the `AmazonSSMManagedInstanceCore` and `CloudWatchAgentServerPolicy` policies attached.

1. Go to the IAM Management Console.
2. Create a new role and select AWS service -> EC2.
    - If you already have an EC2 role the below permissions can be added to the existing role.
3. Attach the `AmazonSSMManagedInstanceCore`, `CloudWatchAgentServerPolicy` policies.
4. Attach this role to your EC2 instances.

## Step 2: Install the SSM Agent

AWS Systems Manager Agent (SSM Agent) is installed by default on Amazon Linux 2 AMIs and some other supported AMIs. If your instance does not have SSM Agent installed, you will need to install it.

## Step 3: Install the CloudWatch Agent

Use SSM to run commands on your EC2 instances to install the CloudWatch Agent.

### Using AWS Management Console

1. Open the AWS Systems Manager console.
2. In the navigation pane, choose **Run Command**.
3. Choose **Run command**.
4. In the **Command document** list, choose `AWS-ConfigureAWSPackage`.
5. In the **Targets** area, select `Specify Instance Tags` and specify the tag `autoalarm:enabled` and leave the value empty.
6. In the **Action** options, select **Install**.
7. For **Name**, type `AmazonCloudWatchAgent`.
8. Uncheck `Enable an S3 bucket` in Output options.
9. Click on **Run**.

## Step 4: Apply the Configuration Using SSM

### Using AWS Management Console

1. Go back to the AWS Systems Manager console.
2. Navigate to **Run Command**.
3. Choose `AmazonCloudWatch-ManageAgent`.
4. Specify the action as **configure**.
5. Set the mode to **ec2**.
6. In the **optionalConfigurationSource** choose **ssm**.
7. Specify the **optionalConfigurationLocation** with the name of the SSM parameter where your configuration is saved.
8. Uncheck `Enable an S3 bucket` in Output options.
9. Select your targets and run the command.
