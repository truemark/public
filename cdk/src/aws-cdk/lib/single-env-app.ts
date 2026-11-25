import {isLowerAlphanumeric, toPascalCase} from '../../helpers/index';
import {ExtendedApp, type ExtendedAppProps} from './extended-app';
import {StandardTags} from './standard-tags';

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
  /**
   * The name of the environment.
   */
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
   * The name of the environment in title case.
   */
  get environmentNameTitleCase(): string {
    return toPascalCase(this.environmentName);
  }
}
