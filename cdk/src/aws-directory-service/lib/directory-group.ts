import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Active Directory group scope.
 */
export type DirectoryGroupScope =
  | 'DomainLocal'
  | 'Global'
  | 'Universal'
  | 'BuiltinLocal';

/**
 * Active Directory group type.
 */
export type DirectoryGroupType = 'Distribution' | 'Security';

/**
 * Properties for DirectoryGroup.
 */
export interface DirectoryGroupProps extends ExtendedConstructProps {
  /**
   * ID of the AWS Managed Microsoft AD directory the group is created in.
   * Pattern: `d-[0-9a-f]{10}`.
   */
  readonly directoryId: string;

  /**
   * The group's SAMAccountName. Must be unique within the directory and at most
   * 20 characters.
   */
  readonly groupName: string;

  /**
   * Scope of the group.
   *
   * @default - the directory default ('Global')
   */
  readonly groupScope?: DirectoryGroupScope;

  /**
   * Type of the group.
   *
   * @default - the directory default ('Security')
   */
  readonly groupType?: DirectoryGroupType;

  /**
   * SAMAccountNames of users, groups, or computers to add as members of the group.
   * Members must already exist in the directory; this construct does not create them.
   *
   * @default - no members are added
   */
  readonly members?: string[];
}

/**
 * Manages an Active Directory group and its memberships in an AWS Managed
 * Microsoft AD directory using the AWS Directory Service Data API.
 *
 * The Directory Service Data API has no native CloudFormation support, so the
 * group and each membership are managed with custom resources.
 *
 * Note: the custom resource Lambda must have the `DirectoryServiceData` client
 * available in its runtime AWS SDK (Node.js 20+). Directory Service Data write
 * operations are scoped to your organizational unit (OU), Managed Microsoft AD
 * only, and available in the directory's primary Region only.
 */
export class DirectoryGroup extends ExtendedConstruct {
  /**
   * The SAMAccountName of the managed group.
   */
  readonly groupName: string;

  constructor(scope: Construct, id: string, props: DirectoryGroupProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    this.groupName = props.groupName;

    const group = new cr.AwsCustomResource(this, 'Group', {
      onCreate: {
        service: 'DirectoryServiceData',
        action: 'CreateGroup',
        parameters: {
          DirectoryId: props.directoryId,
          SAMAccountName: props.groupName,
          ...(props.groupScope ? {GroupScope: props.groupScope} : {}),
          ...(props.groupType ? {GroupType: props.groupType} : {}),
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `${props.directoryId}/${props.groupName}`,
        ),
        // ConflictException: the group already exists — treat as a no-op.
        ignoreErrorCodesMatching: 'ConflictException',
      },
      onDelete: {
        service: 'DirectoryServiceData',
        action: 'DeleteGroup',
        parameters: {
          DirectoryId: props.directoryId,
          SAMAccountName: props.groupName,
        },
        // ResourceNotFoundException / AccessDeniedException: group already gone or
        // outside our OU — safe to ignore so stack teardown is not blocked.
        ignoreErrorCodesMatching:
          'ResourceNotFoundException|AccessDeniedException',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ds-data:CreateGroup', 'ds-data:DeleteGroup'],
          resources: ['*'],
        }),
      ]),
    });

    for (const member of props.members ?? []) {
      const membership = new cr.AwsCustomResource(this, `Member${member}`, {
        onCreate: {
          service: 'DirectoryServiceData',
          action: 'AddGroupMember',
          parameters: {
            DirectoryId: props.directoryId,
            GroupName: props.groupName,
            MemberName: member,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${props.directoryId}/${props.groupName}/${member}`,
          ),
          // ConflictException: member already in the group — treat as a no-op.
          ignoreErrorCodesMatching: 'ConflictException',
        },
        onDelete: {
          service: 'DirectoryServiceData',
          action: 'RemoveGroupMember',
          parameters: {
            DirectoryId: props.directoryId,
            GroupName: props.groupName,
            MemberName: member,
          },
          ignoreErrorCodesMatching:
            'ResourceNotFoundException|AccessDeniedException',
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ds-data:AddGroupMember', 'ds-data:RemoveGroupMember'],
            resources: ['*'],
          }),
        ]),
      });
      // The group must exist before members can be added.
      membership.node.addDependency(group);
    }
  }
}
