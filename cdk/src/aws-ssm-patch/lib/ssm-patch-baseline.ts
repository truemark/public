import {Stack} from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Properties for SsmPatchBaseline.
 */
export interface SsmPatchBaselineProps extends ExtendedConstructProps {
  /**
   * Name for the patch baseline.
   *
   * @default - stack-scoped name (`<stackName>-patch-baseline`)
   */
  readonly name?: string;

  /**
   * Operating system for the patch baseline.
   * Valid values include AMAZON_LINUX_2023, UBUNTU, ROCKY_LINUX,
   * REDHAT_ENTERPRISE_LINUX, DEBIAN, WINDOWS, etc.
   *
   * @default 'AMAZON_LINUX_2023'
   */
  readonly operatingSystem?: string;

  /**
   * SSM patch groups to associate with this baseline.
   * Instances tagged with `Patch Group=<value>` are managed by this baseline.
   *
   * @default []
   */
  readonly patchGroups?: string[];

  /**
   * Human-readable description for the patch baseline.
   */
  readonly description?: string;

  /**
   * Patch classification filter (e.g. 'Security', 'Bugfix').
   *
   * @default ['Security']
   */
  readonly classification?: string[];

  /**
   * Patch severity filter (e.g. 'Critical', 'Important', 'Medium').
   *
   * @default ['Critical', 'Important']
   */
  readonly severity?: string[];

  /**
   * Number of days after release before a patch is auto-approved.
   *
   * @default 7
   */
  readonly approveAfterDays?: number;

  /**
   * SSM compliance level for non-compliant instances.
   * Valid values: CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL, UNSPECIFIED.
   *
   * @default 'CRITICAL'
   */
  readonly complianceLevel?: string;

  /**
   * Whether to include non-security patches in the baseline.
   *
   * @default false
   */
  readonly enableNonSecurity?: boolean;
}

/**
 * Creates an SSM patch baseline with a security-focused approval rule.
 *
 * Patches matching the configured classification and severity filters are
 * auto-approved after approveAfterDays days. Associate instances with this
 * baseline by tagging them with `Patch Group=<value>` and passing the same
 * value via patchGroups.
 *
 * Can be used for any SSM-managed fleet — EC2, hybrid-activated, or WorkSpaces.
 */
export class SsmPatchBaseline extends ExtendedConstruct {
  static readonly DEFAULT_OS = 'AMAZON_LINUX_2023';
  static readonly DEFAULT_CLASSIFICATION = ['Security'];
  static readonly DEFAULT_SEVERITY = ['Critical', 'Important'];
  static readonly DEFAULT_APPROVE_AFTER_DAYS = 7;
  static readonly DEFAULT_COMPLIANCE_LEVEL = 'CRITICAL';

  /**
   * The ID of the created patch baseline.
   */
  readonly patchBaselineId: string;

  constructor(scope: Construct, id: string, props: SsmPatchBaselineProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const stack = Stack.of(this);

    const baseline = new ssm.CfnPatchBaseline(this, 'Resource', {
      name: props.name ?? `${stack.stackName}-patch-baseline`,
      operatingSystem: props.operatingSystem ?? SsmPatchBaseline.DEFAULT_OS,
      description: props.description,
      patchGroups: props.patchGroups ?? [],
      approvalRules: {
        patchRules: [
          {
            patchFilterGroup: {
              patchFilters: [
                {
                  key: 'CLASSIFICATION',
                  values:
                    props.classification ??
                    SsmPatchBaseline.DEFAULT_CLASSIFICATION,
                },
                {
                  key: 'SEVERITY',
                  values: props.severity ?? SsmPatchBaseline.DEFAULT_SEVERITY,
                },
              ],
            },
            approveAfterDays:
              props.approveAfterDays ??
              SsmPatchBaseline.DEFAULT_APPROVE_AFTER_DAYS,
            enableNonSecurity: props.enableNonSecurity ?? false,
            complianceLevel:
              props.complianceLevel ??
              SsmPatchBaseline.DEFAULT_COMPLIANCE_LEVEL,
          },
        ],
      },
    });

    this.patchBaselineId = baseline.ref;
  }
}
