import {ExtendedApp, ExtendedAppProps} from './extended-app';
import {StandardTags} from './standard-tags';
import {isLowerAlphanumeric, toPascalCase} from '../../helpers/index';

/**
 * Properties for SingleEnvApp
 */
export interface SingleEnvAppProps extends ExtendedAppProps {
  /**
   * The name of the property in the context where the environment name is stored.
   * Default is "env".
   *
   * @default - env
   */
  readonly environmentPropertyName?: string;
}

/**
 * Extension of ExtendedApp that supports a standard way to declare environment names.
 */
export class SingleEnvApp extends ExtendedApp {
  readonly environmentName: string;

  constructor(props?: SingleEnvAppProps) {
    super(props);
    const environmentPropertyName = props?.environmentPropertyName ?? 'env';
    this.environmentName = this.node.tryGetContext(environmentPropertyName);
    if (!this.environmentName) {
      throw new Error(
        `Environment is missing. Please add "-c ${environmentPropertyName}=<name>" to your CDK command`,
      );
    }
    if (!isLowerAlphanumeric(this.environmentName)) {
      throw new Error('Environment name must be lower case alpha numeric');
    }
    // Add environment to cost center tags
    if (props?.standardTags?.costCenterTags) {
      new StandardTags(this).addCostCenterTags({
        ...props.standardTags.costCenterTags,
        environment: this.environmentName,
      });
    }
  }

  /**
   * Returns the name of the environment.
   */
  getEnvironmentName(): string {
    return this.environmentName;
  }

  /**
   * Returns the name of the environment in title case.
   */
  getEnvironmentNameTitleCase(): string {
    return toPascalCase(this.environmentName);
  }
}
