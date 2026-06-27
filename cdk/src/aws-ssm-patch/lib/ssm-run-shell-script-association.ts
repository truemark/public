import * as fs from 'node:fs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Properties for SsmRunShellScriptAssociation.
 */
export interface SsmRunShellScriptAssociationProps
  extends ExtendedConstructProps {
  /**
   * Name for the SSM association. Must be unique within the account/region.
   */
  readonly associationName?: string;

  /**
   * Absolute path to a shell script file to embed via State Manager.
   * The file is read at CDK synth time and its content is passed to
   * AWS-RunShellScript. Use `path.join(__dirname, '../scripts/foo.sh')` to
   * resolve relative to your stack file.
   * Mutually exclusive with commands — provide one or the other, not both.
   */
  readonly scriptPath?: string;

  /**
   * Inline shell commands to run via State Manager.
   * Mutually exclusive with scriptPath — provide one or the other, not both.
   */
  readonly commands?: string[];

  /**
   * SSM State Manager targets. Controls which managed instances the script
   * runs on.
   * Example: `[{key: 'tag:ManagedBy', values: ['CDK']}]`
   *
   * @default - all managed instances (`[{key: 'InstanceIds', values: ['*']}]`)
   */
  readonly targets?: ssm.CfnAssociation.TargetProperty[];

  /**
   * Rate or cron expression for the association schedule.
   * Example: `'rate(7 days)'`, `'cron(0 2 ? * SUN *)'`
   *
   * @default 'rate(30 days)'
   */
  readonly scheduleExpression?: string;

  /**
   * SSM compliance severity for non-compliant instances.
   * Valid values: CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL, UNSPECIFIED.
   *
   * @default 'MEDIUM'
   */
  readonly complianceSeverity?: string;

  /**
   * Maximum number of errors allowed before the association stops running on
   * additional targets. Can be an absolute number or a percentage ('10%').
   *
   * @default '1'
   */
  readonly maxErrors?: string;

  /**
   * Maximum number of targets that the association runs on concurrently.
   * Can be an absolute number or a percentage ('50%').
   *
   * @default '50%'
   */
  readonly maxConcurrency?: string;

  /**
   * Execution timeout in seconds passed to AWS-RunShellScript.
   *
   * @default '3600'
   */
  readonly executionTimeout?: string;
}

/**
 * Creates an SSM State Manager association using the AWS-RunShellScript document.
 *
 * Accepts either a shell script file path (read at synth time) or an inline
 * commands array. Can target any set of SSM managed instances — EC2, hybrid-
 * activated, or WorkSpaces — via the targets prop.
 *
 * Runs on the configured schedule and whenever the association is updated
 * (e.g. the script content changes).
 */
export class SsmRunShellScriptAssociation extends ExtendedConstruct {
  /**
   * The ID of the created SSM association.
   */
  readonly associationId: string;

  constructor(
    scope: Construct,
    id: string,
    props: SsmRunShellScriptAssociationProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    let commands: string[];

    if (props.scriptPath) {
      commands = fs.readFileSync(props.scriptPath, 'utf-8').split('\n');
    } else if (props.commands && props.commands.length > 0) {
      commands = props.commands;
    } else {
      throw new Error(
        'SsmRunShellScriptAssociationProps requires either scriptPath or a non-empty commands array',
      );
    }

    const association = new ssm.CfnAssociation(this, 'Resource', {
      name: 'AWS-RunShellScript',
      associationName: props.associationName,
      targets: props.targets ?? [{key: 'InstanceIds', values: ['*']}],
      parameters: {
        commands,
        executionTimeout: [props.executionTimeout ?? '3600'],
      },
      scheduleExpression: props.scheduleExpression ?? 'rate(30 days)',
      applyOnlyAtCronInterval: false,
      complianceSeverity: props.complianceSeverity ?? 'MEDIUM',
      maxErrors: props.maxErrors ?? '1',
      maxConcurrency: props.maxConcurrency ?? '50%',
    });

    this.associationId = association.ref;
  }
}
