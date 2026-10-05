import * as cdk from 'aws-cdk-lib';
import {Tags} from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {LibStandardTags} from '../../truemark';

// Verbatim content of the startup scripts, embedded at build time.
// Shell `$var` and `$(cmd)` references are escaped as `\${var}` / `\$(cmd)`
// to prevent TypeScript template-literal interpolation.

const SNAT_SH = `#!/bin/sh
set -ex
dnf install -y iptables-services awscli || yum install -y iptables-services awscli
if test -f "/etc/nat.conf"; then
    echo "Found nat configuration at /etc/nat.conf"
    . /etc/nat.conf
else
    echo "No nat configuration at /etc/nat.conf"
fi
token="$(curl -sS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 300' http://169.254.169.254/latest/api/token)"
aws_region="$(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/placement/region)"
instance_id="$(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/instance-id)"
# Do not assume the primary interface is named eth0.
# Use the interface that owns the default route.
primary_interface="$(ip route | awk '/default/ {print $5; exit}')"
if test -z "\${primary_interface}"; then
    echo "Could not determine primary/default network interface"
    ip route
    exit 1
fi
primary_mac="$(cat /sys/class/net/\${primary_interface}/address)"
echo "Primary/default interface is \${primary_interface} with MAC \${primary_mac}"
if test -n "\${eni_id}"; then
    echo "Found eni_id configuration, attaching \${eni_id}..."
    primary_eni_id="$(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/network/interfaces/macs/\${primary_mac}/interface-id)"
    echo "Disabling source/dest check on primary ENI \${primary_eni_id}..."
    aws ec2 modify-network-interface-attribute \\
        --region "\${aws_region}" \\
        --network-interface-id "\${primary_eni_id}" \\
        --no-source-dest-check
    echo "Disabling source/dest check on NAT ENI \${eni_id}..."
    aws ec2 modify-network-interface-attribute \\
        --region "\${aws_region}" \\
        --network-interface-id "\${eni_id}" \\
        --no-source-dest-check
    echo "Checking current attachment state for NAT ENI \${eni_id}..."
    attached_instance_id="$(aws ec2 describe-network-interfaces \\
        --region "\${aws_region}" \\
        --network-interface-ids "\${eni_id}" \\
        --query 'NetworkInterfaces[0].Attachment.InstanceId' \\
        --output text 2>/dev/null || true)"
    if test "\${attached_instance_id}" = "\${instance_id}"; then
        echo "NAT ENI \${eni_id} is already attached to this instance."
    elif test -n "\${attached_instance_id}" && test "\${attached_instance_id}" != "None"; then
        echo "NAT ENI \${eni_id} is attached to another instance: \${attached_instance_id}"
        echo "This may be the previous instance during replacement. Retrying for up to 60 seconds..."
        for retry in $(seq 1 12); do
            sleep 5
            attached_instance_id="$(aws ec2 describe-network-interfaces \\
                --region "\${aws_region}" \\
                --network-interface-ids "\${eni_id}" \\
                --query 'NetworkInterfaces[0].Attachment.InstanceId' \\
                --output text 2>/dev/null || true)"
            if test "\${attached_instance_id}" = "\${instance_id}"; then
                echo "ENI is now attached to this instance."
                break
            elif test -z "\${attached_instance_id}" || test "\${attached_instance_id}" = "None"; then
                echo "ENI is now available. Proceeding with attachment."
                break
            fi
            echo "Retry \${retry}/12: ENI still attached to \${attached_instance_id}"
        done
        if test -n "\${attached_instance_id}" && test "\${attached_instance_id}" != "None" && test "\${attached_instance_id}" != "\${instance_id}"; then
            echo "ERROR: ENI \${eni_id} is still attached to another instance after retries: \${attached_instance_id}"
            # Systemd will retry this service. If all systemd retries are exhausted, terminate.
            exit 1
        fi
    fi
    if test "\${attached_instance_id}" != "\${instance_id}"; then
        echo "Attaching NAT ENI \${eni_id} to instance \${instance_id}..."
        # Use if statement to capture exit status before errexit triggers
        if attach_output="$(aws ec2 attach-network-interface \\
            --region "\${aws_region}" \\
            --instance-id "\${instance_id}" \\
            --device-index 1 \\
            --network-interface-id "\${eni_id}" 2>&1)"; then
            echo "\${attach_output}"
            echo "ENI attached successfully."
        else
            attach_status=$?
            echo "\${attach_output}"
            echo "Failed to attach NAT ENI \${eni_id} with status \${attach_status}"
            exit "\${attach_status}"
        fi
    fi
    echo "Waiting for NAT ENI \${eni_id} to appear in metadata..."
    nat_eni_mac=""
    for attempt in $(seq 1 60); do
        for mac in $(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/network/interfaces/macs/); do
            interface_id="$(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/network/interfaces/macs/\${mac}interface-id)"
            if test "\${interface_id}" = "\${eni_id}"; then
                nat_eni_mac="$(echo "\${mac}" | sed 's#/$##')"
                break
            fi
        done
        if test -n "\${nat_eni_mac}"; then
            break
        fi
        echo "Waiting for ENI metadata..."
        sleep 2
    done
    if test -z "\${nat_eni_mac}"; then
        echo "Could not find MAC address for NAT ENI \${eni_id}"
        exit 1
    fi
    nat_eni_linux_device=""
    for dev in $(ls /sys/class/net); do
        dev_mac="$(cat /sys/class/net/\${dev}/address 2>/dev/null || true)"
        if test "\${dev_mac}" = "\${nat_eni_mac}"; then
            nat_eni_linux_device="\${dev}"
            break
        fi
    done
    if test -z "\${nat_eni_linux_device}"; then
        echo "Could not map NAT ENI MAC \${nat_eni_mac} to Linux network device"
        ip link show
        exit 1
    fi
    echo "NAT ENI \${eni_id} is Linux device \${nat_eni_linux_device}"
    # Private subnet routes target the NAT ENI for stable routing, but outbound
    # SNAT leaves through the primary interface (which has the auto-assigned
    # public IP or manually attached EIP). Secondary ENIs don't get auto-assigned
    # public IPs, and setting up policy routing through eth1 is complex.
    nat_interface="\${primary_interface}"
    echo "Using outbound NAT interface \${nat_interface}"
elif test -n "\${interface}"; then
    echo "Found interface configuration, using \${interface}"
    nat_interface="\${interface}"
else
    nat_interface="\${primary_interface}"
    echo "No eni_id or interface configuration found, using default interface \${nat_interface}"
fi
echo "Enabling ip_forward..."
sysctl -q -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-nat.conf
echo "Disabling reverse path protection..."
for i in $(find /proc/sys/net/ipv4/conf/ -name rp_filter); do
  echo 0 > "\${i}";
done
cat > /etc/sysctl.d/98-disable-rp-filter.conf <<'EOF'
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
EOF
echo "Flushing NAT table..."
iptables -t nat -F
echo "Adding NAT rule..."
iptables -t nat -A POSTROUTING -o "\${nat_interface}" -j MASQUERADE -m comment --comment "NAT routing rule installed"
echo "Current NAT table:"
iptables -t nat -L -n -v
service iptables save || true
echo "Done!"
`;

const SNAT_SERVICE = `[Unit]
Description = Configure this machine to act as a NAT instance.
Wants = network-online.target
After = network-online.target
# If NAT setup fails after all retries, terminate the instance so ASG replaces it
OnFailure = snat-failure.service

[Service]
ExecStart = /opt/nat/snat.sh
Type = oneshot
# Retry on failure to handle transient ENI attachment issues during ASG replacement.
# If ENI is still attached to previous instance, systemd will retry after 30s.
Restart = on-failure
RestartSec = 30s
# Limit total retries to 10 attempts. StartLimitIntervalSec=0 means infinite window,
# ensuring the 10th failure triggers OnFailure rather than resetting every 5 minutes.
StartLimitIntervalSec = 0
StartLimitBurst = 10

[Install]
WantedBy = multi-user.target
`;

const SNAT_FAILURE_SERVICE = `[Unit]
Description = Terminate NAT instance after unrecoverable setup failure
DefaultDependencies = no

[Service]
Type = oneshot
ExecStart = /opt/nat/terminate-on-failure.sh
`;

const TERMINATE_ON_FAILURE_SH = `#!/bin/sh
# This script is invoked by snat-failure.service when NAT setup fails after all retries.
# Terminating the instance triggers ASG to replace it, preventing blackholed routes.
set -ex
token="$(curl -sS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 300' http://169.254.169.254/latest/api/token)"
aws_region="$(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/placement/region)"
instance_id="$(curl -sS -H "X-aws-ec2-metadata-token: \${token}" http://169.254.169.254/latest/meta-data/instance-id)"
echo "FATAL: NAT setup failed after all retries. Terminating instance \${instance_id} to trigger ASG replacement..."
aws ec2 terminate-instances --instance-ids "\${instance_id}" --region "\${aws_region}"
`;

const RUNONCE_SH = `#!/bin/bash -x

# start SNAT
systemctl enable snat
systemctl start snat
`;

/**
 * An additional file to write via cloud-init write_files.
 */
export interface NatInstanceWriteFile {
  /** Absolute path on the instance where the file will be written. */
  readonly path: string;
  /** File content. */
  readonly content: string;
  /** Octal file permissions string, e.g. '0755'. */
  readonly permissions?: string;
}

/**
 * Properties for NatInstance.
 */
export interface NatInstanceProps extends ExtendedConstructProps {
  /**
   * VPC to place the NAT instance in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The public subnet where the ENI and instance will live.
   */
  readonly publicSubnet: ec2.ISubnet;

  /**
   * CIDR blocks of private subnets. Used for the security group ingress rule
   * so that private instances can route traffic through the NAT instance.
   */
  readonly privateSubnetCidrBlocks: string[];

  /**
   * Whether to run the ASG at desired capacity of 1. When false the ASG is
   * set to desired/min=0, effectively pausing the NAT instance without
   * destroying the ENI or other resources. Default is true.
   *
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * IDs of private route tables that should receive a 0.0.0.0/0 default
   * route pointing to the NAT instance ENI. Typically one per AZ.
   */
  readonly privateRouteTableIds?: string[];

  /**
   * Custom AMI ID. When omitted the latest Amazon Linux 2023 standard AMI
   * is used, filtered by the resolved architecture. The standard edition
   * includes the SSM agent for remote management.
   */
  readonly imageId?: string;

  /**
   * CPU architecture used for the AMI lookup. Default is ARM_64, which
   * corresponds to the default t4g.micro instance type.
   *
   * @default ec2.AmazonLinuxCpuType.ARM_64
   */
  readonly architecture?: ec2.AmazonLinuxCpuType;

  /**
   * EC2 instance types for the Auto Scaling Group mixed instances policy.
   * Defaults based on architecture: t4g.micro for ARM64 (~$6/month on-demand),
   * t3a.micro for X86_64 (~$7.60/month on-demand).
   *
   * @default [new ec2.InstanceType('t4g.micro')] for ARM64, [new ec2.InstanceType('t3a.micro')] for X86_64
   */
  readonly instanceTypes?: ec2.InstanceType[];

  /**
   * Use Spot instances instead of On-Demand. Spot can reduce cost to ~$1/month
   * but the instance may be interrupted with a 2-minute warning. Default is false.
   *
   * @default false
   */
  readonly useSpotInstance?: boolean;

  /**
   * Name of an existing EC2 key pair to allow SSH access. When omitted,
   * AWS Systems Manager Session Manager (enabled via the attached SSM policy)
   * is the only console access method.
   */
  readonly keyName?: string;

  /**
   * Additional cloud-init write_files entries appended after the built-in
   * NAT scripts. Useful for injecting custom configuration files.
   */
  readonly additionalWriteFiles?: NatInstanceWriteFile[];

  /**
   * Additional cloud-init runcmd entries appended after /opt/nat/runonce.sh.
   * Each inner array represents one command invocation (argv style).
   */
  readonly additionalRunCmds?: string[][];

  /**
   * ARN of the IAM managed policy attached to the instance role for Systems
   * Manager access. When omitted, uses AmazonSSMManagedInstanceCore resolved
   * for the stack's partition (works in GovCloud and China).
   *
   * @default AmazonSSMManagedInstanceCore (partition-agnostic)
   */
  readonly ssmPolicyArn?: string;
}

/**
 * Indents script content for embedding in a YAML literal block scalar.
 * Each line is prefixed with 4 spaces; blank lines are left truly empty
 * to satisfy strict YAML parsers. The trailing newline produced by scripts
 * ending with \n is consumed (the YAML `|` chomping handles it).
 */
function indentLiteralBlock(content: string): string {
  const lines = content.split('\n');
  // Drop the last element when it is an empty string produced by a
  // trailing \n — the `|` block indicator already implies one final newline.
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map((line) => (line === '' ? '' : `    ${line}`)).join('\n');
}

/**
 * Renders a single cloud-init write_files list entry as YAML, using a
 * literal block scalar for the content field to avoid any escaping issues
 * with shell special characters.
 */
function writeFileEntry(
  path: string,
  content: string,
  permissions?: string,
): string {
  const permsLine =
    permissions !== undefined ? `\n  permissions: '${permissions}'` : '';
  return `- path: ${path}${permsLine}\n  content: |\n${indentLiteralBlock(content)}\n`;
}

/**
 * A self-healing, cost-optimised NAT instance for private subnet egress.
 *
 * This is a CDK port of the truemark/nat-instance Terraform module. It
 * provisions:
 * - A dedicated secondary Elastic Network Interface (ENI) with source/dest
 *   check disabled. Private subnets route to this ENI, which persists across
 *   instance replacements. Actual NAT egress happens through the instance's
 *   primary interface (which has an auto-assigned public IP by default).
 * - An IAM role with AmazonSSMManagedInstanceCore and the EC2 permissions
 *   needed for snat.sh to attach the secondary ENI at boot.
 * - An EC2 Launch Template running Amazon Linux 2023 standard (ARM64 by
 *   default) with a cloud-init user-data that installs iptables, attaches
 *   the ENI, enables IP forwarding, and sets up NAT masquerading.
 * - An Auto Scaling Group (desired=1) that auto-replaces the instance on
 *   failure, keeping the ENI persistent across replacements.
 * - Optional 0.0.0.0/0 routes in private route tables pointing to the ENI.
 *
 * **Usage with StandardNetwork:**
 * ```ts
 * const network = new StandardNetwork(this, 'Network', {
 *   name: 'prod',
 *   vpcCidr: '10.0.0.0/20',
 *   natType: 'none',   // no managed NAT gateway
 * });
 *
 * const nat = new NatInstance(this, 'Nat', {
 *   vpc: network.vpc,
 *   publicSubnet: network.vpc.selectSubnets({subnetGroupName: 'public'}).subnets[0],
 *   privateSubnetCidrBlocks: ['10.0.0.0/24'],
 *   privateRouteTableIds: network.vpc
 *     .selectSubnets({subnetGroupName: 'private'})
 *     .subnets.map(s => s.routeTable.routeTableId),
 * });
 *
 * // The instance's primary interface gets an auto-assigned public IP.
 * // For a stable outbound IP, allocate and associate an EIP with the
 * // instance's primary interface using ASG lifecycle hooks or tags.
 * // Example:
 * // const eip = new ec2.CfnEIP(this, 'NatEip', {domain: 'vpc'});
 * // Associate the EIP with new instances via lifecycle hook or tag matching.
 * ```
 *
 * > **Note:** This construct is optimised for cost (ARM64 spot/on-demand
 * > t4g.micro at ~$2–6/month) and is suitable for dev/staging environments.
 * > For production use prefer AWS NAT Gateway or a larger instance type with
 * > `useSpotInstance: false`.
 */
export class NatInstance extends ExtendedConstruct {
  /**
   * CloudFormation resource ID of the dedicated secondary ENI. Private subnet
   * routes point to this ENI, which persists across instance replacements.
   * Note: NAT egress occurs through the primary interface, not this ENI.
   */
  readonly eniId: string;

  /**
   * Primary private IPv4 address of the dedicated ENI.
   */
  readonly eniPrivateIp: string;

  /**
   * Security group ID of the NAT instance security group.
   */
  readonly sgId: string;

  /**
   * Name of the IAM role attached to the NAT instance.
   */
  readonly iamRoleName: string;

  constructor(scope: Construct, id: string, props: NatInstanceProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const enabled = props.enabled ?? true;
    const architecture = props.architecture ?? ec2.AmazonLinuxCpuType.ARM_64;

    // Unique tag value for this NAT instance, used to scope IAM permissions
    const natInstanceRoleTag = `nat-instance-${id}`;

    // Derive default instance type from architecture to avoid AMI/instance mismatch
    // Use micro (1GB RAM) instead of nano (512MB) to prevent OOM during package installation
    const defaultInstanceType =
      architecture === ec2.AmazonLinuxCpuType.X86_64
        ? new ec2.InstanceType('t3a.micro')
        : new ec2.InstanceType('t4g.micro');

    const instanceTypes = props.instanceTypes ?? [defaultInstanceType];
    if (instanceTypes.length === 0) {
      throw new Error(
        'instanceTypes must contain at least one instance type. Omit the property to use the architecture-appropriate default (t4g.micro for ARM64, t3a.micro for X86_64).',
      );
    }
    const useSpotInstance = props.useSpotInstance ?? false;

    // ── Security Group ────────────────────────────────────────────────────────
    const sg = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: `Security group for NAT instance ${id}`,
      allowAllOutbound: true, // mirrors the egress all-traffic rule in Terraform
    });
    for (const cidr of props.privateSubnetCidrBlocks) {
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.allTraffic());
    }
    this.sgId = sg.securityGroupId;

    // ── Elastic Network Interface ─────────────────────────────────────────────
    // No L2 ENI construct exists — use L1 directly.
    // source_dest_check=false is required for the instance to forward packets.
    const eni = new ec2.CfnNetworkInterface(this, 'Eni', {
      subnetId: props.publicSubnet.subnetId,
      groupSet: [sg.securityGroupId],
      sourceDestCheck: false,
      description: `ENI for NAT instance ${id}`,
    });
    Tags.of(eni).add('Name', `nat-instance-${id}`);
    this.eniId = eni.ref;
    this.eniPrivateIp = eni.attrPrimaryPrivateIpAddress;

    // ── Private Routes ────────────────────────────────────────────────────────
    // CfnRoute is used because the L2 Route construct does not support
    // targeting a raw ENI as the next hop.
    for (let i = 0; i < (props.privateRouteTableIds ?? []).length; i++) {
      new ec2.CfnRoute(this, `PrivateRoute${i}`, {
        routeTableId: props.privateRouteTableIds![i],
        destinationCidrBlock: '0.0.0.0/0',
        networkInterfaceId: eni.ref,
      });
    }

    // ── IAM Role ──────────────────────────────────────────────────────────────
    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // Add SSM managed policy (partition-agnostic when no override provided)
    if (props.ssmPolicyArn) {
      role.addManagedPolicy(
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          'SsmPolicy',
          props.ssmPolicyArn,
        ),
      );
    } else {
      role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
      );
    }

    // snat.sh calls aws ec2 describe/attach/modify operations at instance boot.
    // Describe actions use wildcard; Attach/Modify are constrained to the dedicated ENI.
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:DescribeNetworkInterfaces', 'ec2:DescribeInstances'],
        resources: ['*'],
      }),
    );
    // AttachNetworkInterface on instances - restricted to instances with matching tag
    // to prevent attaching arbitrary ENIs to arbitrary instances.
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AttachNetworkInterface'],
        resources: [
          `arn:${cdk.Stack.of(this).partition}:ec2:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:instance/*`,
        ],
        conditions: {
          StringEquals: {
            'ec2:ResourceTag/nat-instance-role': natInstanceRoleTag,
          },
        },
      }),
    );
    // AttachNetworkInterface only on the specific NAT ENI
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AttachNetworkInterface'],
        resources: [
          `arn:${cdk.Stack.of(this).partition}:ec2:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:network-interface/${eni.ref}`,
        ],
      }),
    );
    // ModifyNetworkInterfaceAttribute on network-interfaces within VPC (for primary ENI source/dest check)
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:ModifyNetworkInterfaceAttribute'],
        resources: [
          `arn:${cdk.Stack.of(this).partition}:ec2:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:network-interface/*`,
        ],
        conditions: {
          StringEquals: {
            'ec2:Vpc': `arn:${cdk.Stack.of(this).partition}:ec2:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:vpc/${props.vpc.vpcId}`,
          },
        },
      }),
    );
    this.iamRoleName = role.roleName;

    // ── Machine Image ─────────────────────────────────────────────────────────
    const machineImage: ec2.IMachineImage = props.imageId
      ? new RawAmiMachineImage(props.imageId)
      : ec2.MachineImage.latestAmazonLinux2023({
          cpuType: architecture,
          edition: ec2.AmazonLinuxEdition.STANDARD,
        });

    // ── User Data (cloud-init) ────────────────────────────────────────────────
    // /etc/nat.conf tells snat.sh which ENI to attach as eth1 at boot.
    // eni.ref is a CFN token resolved to the ENI resource ID at deploy time.
    const natConfContent = `eni_id=${eni.ref}\n`;

    const cloudConfig =
      '#cloud-config\n' +
      'write_files:\n' +
      writeFileEntry('/opt/nat/runonce.sh', RUNONCE_SH, '0755') +
      writeFileEntry('/opt/nat/snat.sh', SNAT_SH, '0755') +
      writeFileEntry(
        '/opt/nat/terminate-on-failure.sh',
        TERMINATE_ON_FAILURE_SH,
        '0755',
      ) +
      writeFileEntry('/etc/systemd/system/snat.service', SNAT_SERVICE) +
      writeFileEntry(
        '/etc/systemd/system/snat-failure.service',
        SNAT_FAILURE_SERVICE,
      ) +
      // nat.conf: plain literal block — ENI ID is alphanumeric+hyphen, safe in YAML
      `- path: /etc/nat.conf\n  permissions: '0644'\n  content: |\n    ${natConfContent}` +
      (props.additionalWriteFiles ?? [])
        .map((f) => writeFileEntry(f.path, f.content, f.permissions))
        .join('') +
      'runcmd:\n' +
      '- ["/opt/nat/runonce.sh"]\n' +
      (props.additionalRunCmds ?? [])
        .map((cmd) => `- [${cmd.map((c) => JSON.stringify(c)).join(', ')}]\n`)
        .join('');

    const userData = ec2.UserData.custom(cloudConfig);

    // ── Launch Template ───────────────────────────────────────────────────────
    const lt = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      machineImage,
      role,
      userData,
      securityGroup: sg,
      keyPair: props.keyName
        ? ec2.KeyPair.fromKeyPairName(this, 'KeyPair', props.keyName)
        : undefined,
      requireImdsv2: true,
      // instanceType is omitted — set via mixedInstancesPolicy overrides below
      // securityGroup is omitted — the pinned ENI carries its own SG
    });

    // ── Auto Scaling Group ────────────────────────────────────────────────────
    const asg = new autoscaling.AutoScalingGroup(this, 'AutoScalingGroup', {
      vpc: props.vpc,
      // The pinned ENI controls actual AZ placement; vpcSubnets keeps CDK happy.
      vpcSubnets: {subnets: [props.publicSubnet]},
      minCapacity: enabled ? 1 : 0,
      maxCapacity: 1,
      desiredCapacity: enabled ? 1 : 0,
      healthCheck: autoscaling.HealthCheck.ec2({
        // Extended grace period to allow NAT setup to complete.
        // Note: This only checks EC2 instance health, not NAT setup success directly.
        // However, snat.service is configured to retry on failure and will terminate
        // the instance if all retries are exhausted, triggering ASG replacement.
        grace: cdk.Duration.minutes(5),
      }),
      mixedInstancesPolicy: {
        launchTemplate: lt,
        instancesDistribution: {
          onDemandBaseCapacity: useSpotInstance ? 0 : 1,
          onDemandPercentageAboveBaseCapacity: useSpotInstance ? 0 : 100,
        },
        launchTemplateOverrides: instanceTypes.map((it) => ({
          instanceType: it,
        })),
      },
    });

    // Tag the ASG instances with the unique identifier used in IAM conditions.
    // This tag is propagated to instances and restricts IAM permissions to self-only operations.
    Tags.of(asg).add('nat-instance-role', natInstanceRoleTag);

    // Allow instance to terminate itself on unrecoverable NAT setup failure.
    // Restricted to instances with the matching nat-instance-role tag,
    // ensuring the instance can only terminate itself, not other instances in the VPC.
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:TerminateInstances'],
        resources: [
          `arn:${cdk.Stack.of(this).partition}:ec2:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:instance/*`,
        ],
        conditions: {
          StringEquals: {
            'ec2:ResourceTag/nat-instance-role': natInstanceRoleTag,
          },
        },
      }),
    );

    // Use rolling update to avoid race condition with ENI attachment.
    // autoScalingReplacingUpdate can create overlapping instances that both
    // try to attach the singleton ENI, causing the boot script to fail.
    const cfnAsg = asg.node.defaultChild as autoscaling.CfnAutoScalingGroup;
    cfnAsg.cfnOptions.updatePolicy = {
      autoScalingRollingUpdate: {
        maxBatchSize: 1,
        minInstancesInService: 0,
        pauseTime: 'PT5M',
      },
    };

    Tags.of(asg).add('Name', `nat-instance-${id}`);
  }
}

/**
 * Minimal IMachineImage implementation for a caller-supplied AMI ID.
 *
 * MachineImage.genericLinux() requires a concrete region key at synth time,
 * which breaks environment-agnostic stacks. This implementation passes the
 * AMI ID through directly and lets CloudFormation handle region resolution.
 */
class RawAmiMachineImage implements ec2.IMachineImage {
  constructor(private readonly amiId: string) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getImage(_scope: Construct): ec2.MachineImageConfig {
    return {
      imageId: this.amiId,
      osType: ec2.OperatingSystemType.LINUX,
      userData: ec2.UserData.forLinux(),
    };
  }
}
