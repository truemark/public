import {Construct} from 'constructs';
import {Stack, Stage, TagProps, Tags} from 'aws-cdk-lib';

export const EXCLUDED_RESOURCES = [
  // OAM resources do not like : in the tag names. See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-oam-link.html#cfn-oam-link-tags
  'AWS::Oam::Link',
  'AWS::Oam::Sink',
  'AWS::OpenSearchServerless::Collection',
];

/**
 * Properties for automation component tags.
 * You may exclude resources for all standard tags using the inherited property excludeResourceTypes.
 */
export interface AutomationComponentTagsProps extends TagProps {
  /**
   * The ID of the component.
   */
  readonly id?: string;

  /**
   * The URL of the component.
   */
  readonly url?: string;

  /**
   * The vendor of the component.
   */
  readonly vendor?: string;
}

/**
 * Properties for automation tags.
 * You may exclude resources using the inherited property excludeResourceTypes.
 */
export interface AutomationTagsProps extends TagProps {
  /**
   * The ID of the stack. If one if not provided, the name of the stack is used.
   *
   * @default - Stack.of(this).stackName
   */
  readonly id?: string;

  /**
   * The URL to where the automation is stored or published. This field is required
   * when applying automation tags.
   */
  readonly url?: string;
}

/**
 * Properties for cost center tags.
 * You may exclude resources using the inherited property excludeResourceTypes.
 */
export interface CostCenterTagsProps extends TagProps {
  /**
   * Name of the project responsible for creating the costs.
   */
  readonly projectName?: string;

  /**
   * Identifier for the project responsible for creating the costs.
   */
  readonly projectId?: string;

  /**
   * Name of the environment incurring the costs. Example "stage" or "prod"
   */
  readonly environment?: string;

  /**
   * Name of the contact responsible for costs associated with the tagged resources.
   * If not set, the tag is not created.
   */
  readonly contactName?: string;

  /**
   * Email of the contact responsible for the costs associated with the tagged resources.
   * If not set, the tag is not created.
   */
  readonly contactEmail?: string;

  /**
   * Phone number of the contact responsible for costs associated with the tagged resources.
   * If not set, the tag is not created.
   */
  readonly contactPhone?: string;

  /**
   * Name of the business unit responsible for the costs associated with the tagged resources.
   */
  readonly businessUnitName?: string;

  /**
   * Identifier for the business unit responsible for the costs associated with the tagged resources.
   */
  readonly businessUnitId?: string;

  /**
   * Name of the business division responsible for the costs associated with the tagged resources.
   */
  readonly divisionName?: string;

  /**
   * Identifier for the business division responsible for the costs associated with the tagged resources.
   */
  readonly divisionId?: string;

  /**
   * Name of the department responsible for the costs associated with the tagged resources.
   */
  readonly departmentName?: string;

  /**
   * Identifier for the department responsible for the costs associated with the tagged resources.
   */
  readonly departmentId?: string;
}

/**
 * Holds values that may be applied to the data-classification security tag.
 */
export enum DataClassification {
  /**
   * Used when data may not leave the geographic region in which it is stored.
   * This is usually related to government restrictions applied to the data.
   */
  ExportRestricted = 'export-restricted',

  /**
   * Used when unauthorized disclosure, alteration or destruction of data would
   * result in a significant risk to the organization. This includes PII, PHI
   * and PCI data.
   */
  Restricted = 'restricted',

  /**
   * Used when unauthorized disclosure, alteration or destruction of the data would
   * result in moderate risk. This includes all data that is not in one of the other
   * classifications.
   */
  Controlled = 'controlled',

  /**
   * Used when handled or stored data readily available to the public.
   */
  Public = 'public',
}

/**
 * Holds values that may be applied to the data-sensitivity security tag.
 */
export enum DataSensitivity {
  /**
   * Used when resources are in PCI scope.
   */
  PCI = 'pci',

  /**
   * Used when resources handle or store personally identifiable information.
   */
  PII = 'pii',

  /**
   * Used when resources handle or store personal health information and are
   * subject to HIPPA rules.
   */
  PHI = 'phi',

  /**
   * Used when there is no data sensitivity.
   */
  NONE = 'none',
}

/**
 * Properties for security tags.
 * You may exclude resources using the inherited property excludeResourceTypes.
 */
export interface SecurityTagsProps extends TagProps {
  /**
   * Data classification value. See the TrueMark AWS tagging strategy documentation.
   */
  readonly dataClassification?: DataClassification;

  /**
   * Data sensitivity. See the TrueMark AWS tagging strategy documentation.
   */
  readonly dataSensitivity?: DataSensitivity;
}

/**
 * Properties for team tags.
 * You may exclude resources using the inherited property excludeResourceTypes.
 */
export interface TeamTagsProps extends TagProps {
  /**
   * Name of the team.
   */
  readonly name?: string;

  /**
   * Identifier if different than the team name.
   */
  readonly id?: string;

  /**
   * Name of the team lead.
   */
  readonly contactName?: string;

  /**
   * Email of the team lead.
   */
  readonly contactEmail?: string;

  /**
   * Phone number for the team lead.
   */
  readonly contactPhone?: string;

  /**
   * Name of the business unit responsible for the team associated with the tagged resources.
   */
  readonly businessUnitName?: string;

  /**
   * Identifier for the business unit responsible for the team associated with the tagged resources.
   */
  readonly businessUnitId?: string;

  /**
   * Name of the business division responsible for the team associated with the tagged resources.
   */
  readonly divisionName?: string;

  /**
   * Identifier for the business division responsible for the team associated with the tagged resources.
   */
  readonly divisionId?: string;

  /**
   * Name of the department responsible for the team associated with the tagged resources.
   */
  readonly departmentName?: string;

  /**
   * Identifier for the department responsible for the team associated with the tagged resources.
   */
  readonly departmentId?: string;
}

/**
 * Contains standard tagging properties.
 * You may exclude resources using the inherited property excludeResourceTypes.
 */
export interface StandardTagsProps extends TagProps {
  /**
   * Automation component tags.
   */
  readonly automationComponentTags?: AutomationComponentTagsProps;

  /**
   * Automation tags to apply to created resources.
   */
  readonly automationTags?: AutomationTagsProps;

  /**
   * Cost center tags to apply to created resources.
   */
  readonly costCenterTags?: CostCenterTagsProps;

  /**
   * Security tags to apply to created resources.
   */
  readonly securityTags?: SecurityTagsProps;

  /**
   * Team tags to apply to created resources.
   */
  readonly teamTags?: TeamTagsProps;

  /**
   * The map migrated tag value.
   */
  readonly mapMigrated?: string;

  /**
   * Setting this to true will suppress the creation of tags this resource creates.
   * Default value is false.
   *
   * @default - false
   */
  readonly suppressTagging?: boolean;
}

/**
 * Provides convenience methods to tag resources following TrueMark's tagging strategy.
 */
export class StandardTags {
  /**
   * The scope being tagged.
   */
  readonly scope: Construct;

  /**
   * The tags.
   */
  readonly tags: Tags;

  /**
   * If tags were suppressed.
   */
  readonly suppressed: boolean;

  /**
   * Creates a new StandardTags instance.
   *
   * @param scope the scope to tag
   * @param props the properties
   */
  constructor(scope: Construct, props?: StandardTagsProps) {
    props = {
      ...props,
      excludeResourceTypes: [
        ...EXCLUDED_RESOURCES, // Add globally excluded resource types so tags don't apply
        ...(props?.excludeResourceTypes ?? []),
      ],
    };
    this.scope = scope;
    this.tags = Tags.of(scope);
    this.suppressed = props?.suppressTagging ?? false;
    const standardTagsProps = StandardTags.merge(
      scope.node.tryGetContext('standardTags'),
      props,
    );
    this.addAutomationComponentTags({
      ...props,
      ...standardTagsProps.automationComponentTags,
    });
    this.addAutomationTags({
      ...props,
      ...standardTagsProps.automationTags,
    });
    this.addCostCenterTags({
      ...props,
      ...standardTagsProps.costCenterTags,
    });
    this.addSecurityTags({
      ...props,
      ...standardTagsProps.securityTags,
    });
    this.addTeamTags({
      ...props,
      ...standardTagsProps.teamTags,
    });
    if (standardTagsProps?.mapMigrated) {
      this.tags.add('map-migrated', standardTagsProps.mapMigrated, props);
    }
  }

  /**
   * Adds automation component tags. These are meant to be used in individual constructs to identify
   * what resources were stood up by specific constructs.
   *
   * @param props optional properties for the tags
   */
  addAutomationComponentTags(
    props?: AutomationComponentTagsProps,
  ): StandardTags {
    if (props && !this.suppressed) {
      if (props.id === '{{TMCDK}}') {
        this.tags.add('automation:component-id', this.scope.constructor.name, {
          ...props,
          excludeResourceTypes: [''],
        });
        this.tags.add(
          'automation:component-url',
          'https://github.com/truemark/cdk',
          props,
        );
        this.tags.add('automation:component-vendor', 'TrueMark', props);
      } else {
        if (props.id) {
          this.tags.add('automation:component-id', props.id, props);
        }
        if (props.url) {
          this.tags.add('automation:component-url', props.url, props);
        }
        if (props.vendor) {
          this.tags.add('automation:component-vendor', props.vendor, props);
        }
      }
    }
    return this;
  }

  /**
   * Adds automation tags.
   *
   * @param props properties for the tags
   */
  addAutomationTags(props?: AutomationTagsProps): StandardTags {
    if (!this.suppressed) {
      let id: string | undefined = props?.id;
      if (!Stage.isStage(this.scope) && !id) {
        id = Stack.of(this.scope).stackName;
      }
      if (id) {
        this.tags.add('automation:id', id, props);
      }
      if (props?.url) {
        this.tags.add('automation:url', props.url, props);
      }
    }
    return this;
  }

  /**
   * Adds cost center tags.
   *
   * @param props properties for the tags
   */
  addCostCenterTags(props?: CostCenterTagsProps): StandardTags {
    if (props && !this.suppressed) {
      if (props.projectName) {
        this.tags.add('cost-center:project-name', props.projectName, props);
      }
      if (props.projectId) {
        this.tags.add('cost-center:project-id', props.projectId, props);
      }
      if (props.environment) {
        this.tags.add('cost-center:environment', props.environment, props);
      }
      if (props.contactName) {
        this.tags.add('cost-center:contact-name', props.contactName, props);
      }
      if (props.contactEmail) {
        this.tags.add('cost-center:contact-email', props.contactEmail, props);
      }
      if (props.contactPhone) {
        this.tags.add('cost-center:contact-phone', props.contactPhone, props);
      }
      if (props.businessUnitName) {
        this.tags.add(
          'cost-center:business-unit-name',
          props.businessUnitName,
          props,
        );
      }
      if (props.businessUnitId) {
        this.tags.add(
          'cost-center:business-unit-id',
          props.businessUnitId,
          props,
        );
      }
      if (props.divisionName) {
        this.tags.add('cost-center:division-name', props.divisionName, props);
      }
      if (props.divisionId) {
        this.tags.add('cost-center:division-id', props.divisionId, props);
      }
      if (props.departmentName) {
        this.tags.add(
          'cost-center:department-name',
          props.departmentName,
          props,
        );
      }
      if (props.departmentId) {
        this.tags.add('cost-center:department-id', props.departmentId, props);
      }
    }
    return this;
  }

  /**
   * Adds security tags.
   *
   * @param props properties for security tags
   */
  addSecurityTags(props?: SecurityTagsProps): StandardTags {
    if (props && !this.suppressed) {
      if (props.dataClassification) {
        this.tags.add(
          'security:data-classification',
          props.dataClassification,
          props,
        );
      }
      if (props.dataSensitivity) {
        this.tags.add(
          'security:data-sensitivity',
          props.dataSensitivity,
          props,
        );
      }
    }
    return this;
  }

  /**
   * Adds team tags.
   *
   * @param props properties for team tags
   */
  addTeamTags(props?: TeamTagsProps): StandardTags {
    if (props && !this.suppressed) {
      if (props.name) {
        this.tags.add('team:name', props.name, props);
      }
      if (props.id) {
        this.tags.add('team:id', props.id, props);
      }
      if (props.contactName) {
        this.tags.add('team:contact-name', props.contactName, props);
      }
      if (props.contactEmail) {
        this.tags.add('team:contact-email', props.contactEmail, props);
      }
      if (props.contactPhone) {
        this.tags.add('team:contact-phone', props.contactPhone, props);
      }
      if (props.businessUnitName) {
        this.tags.add('team:business-unit-name', props.businessUnitName, props);
      }
      if (props.businessUnitId) {
        this.tags.add('team:business-unit-id', props.businessUnitId, props);
      }
      if (props.divisionName) {
        this.tags.add('team:division-name', props.divisionName, props);
      }
      if (props.divisionId) {
        this.tags.add('team:division-id', props.divisionId, props);
      }
      if (props.departmentName) {
        this.tags.add('team:department-name', props.departmentName, props);
      }
      if (props.departmentId) {
        this.tags.add('team:department-id', props.departmentId, props);
      }
    }
    return this;
  }

  /**
   * Returns a merged StandardTagsProps.
   *
   * @param from properties to source from
   * @param to properties to source to
   */
  static merge(
    from?: StandardTagsProps,
    to?: StandardTagsProps,
  ): StandardTagsProps {
    let excludeResourceTypes: string[] | undefined = undefined;
    if (from?.excludeResourceTypes || to?.excludeResourceTypes) {
      excludeResourceTypes = [
        ...(from?.excludeResourceTypes ?? []),
        ...(to?.excludeResourceTypes ?? []),
      ];
    }
    let automationComponentTags: AutomationComponentTagsProps | undefined =
      undefined;
    if (from?.automationComponentTags || to?.automationComponentTags) {
      automationComponentTags = {
        id:
          to?.automationComponentTags?.id ??
          from?.automationComponentTags?.id ??
          '',
        ...from?.automationComponentTags,
        ...to?.automationComponentTags,
      };
    }
    let automationTags: AutomationTagsProps | undefined = undefined;
    if (from?.automationTags || to?.automationTags) {
      automationTags = {
        id: to?.automationTags?.id ?? from?.automationTags?.id ?? '',
        ...from?.automationTags,
        ...to?.automationTags,
      };
    }
    let costCenterTags: CostCenterTagsProps | undefined = undefined;
    if (from?.costCenterTags || to?.costCenterTags) {
      costCenterTags = {
        businessUnitName:
          to?.costCenterTags?.businessUnitName ??
          from?.costCenterTags?.businessUnitName ??
          '',
        projectName:
          to?.costCenterTags?.projectName ??
          from?.costCenterTags?.projectName ??
          '',
        ...from?.costCenterTags,
        ...to?.costCenterTags,
      };
    }
    let securityTags: SecurityTagsProps | undefined = undefined;
    if (from?.securityTags || to?.securityTags) {
      securityTags = {
        dataClassification:
          to?.securityTags?.dataClassification ??
          from?.securityTags?.dataClassification ??
          DataClassification.Controlled,
        ...from?.securityTags,
        ...to?.securityTags,
      };
    }
    let teamTags: TeamTagsProps | undefined = undefined;
    if (from?.teamTags || to?.teamTags) {
      teamTags = {
        name: to?.teamTags?.name ?? from?.teamTags?.name ?? '',
        ...from?.teamTags,
        ...to?.teamTags,
      };
    }
    return {
      mapMigrated: to?.mapMigrated ?? from?.mapMigrated,
      automationComponentTags,
      automationTags,
      costCenterTags,
      securityTags,
      teamTags,
      suppressTagging: to?.suppressTagging ?? from?.suppressTagging ?? false,
      excludeResourceTypes,
    };
  }
}
