import {App, AppProps} from 'aws-cdk-lib';
import {StandardTagsProps} from './standard-tags';

/**
 * Properties for ExtendedApp.
 */
export interface ExtendedAppProps extends AppProps {
  /**
   * Standard tags to apply to all stacks.
   */
  readonly standardTags?: StandardTagsProps;

  /**
   * Skips account lookup and uses this account.
   */
  readonly account?: string;

  /**
   * Skips region lookup and uses this region.
   */
  readonly region?: string;
}

/**
 * Adds functionality to the base App class to support standard tags
 * and access to the account and region being used to execute the
 * CDK process.
 */
export class ExtendedApp extends App {
  readonly account: string;
  readonly region: string;

  constructor(props?: ExtendedAppProps) {
    super({
      ...props,
      context: {
        ...props?.context,
        // Add standardTags to the context to be used by ExtendedStack
        standardTags: props?.standardTags,
      },
    });

    // Use the provided account or do a lookup
    const account =
      props?.account ||
      process.env.CDK_DEFAULT_ACCOUNT ||
      process.env.AWS_ACCOUNT_ID;
    if (account === undefined) {
      throw new Error('Unable to identify default account');
    }
    this.account = account;

    // Use the provided region or do a lookup
    const region =
      props?.region ||
      process.env.CDK_DEFAULT_REGION ||
      process.env.AWS_DEFAULT_REGION;
    if (region === undefined) {
      throw new Error('Unable to identify default region');
    }
    this.region = region;

    // Add automation component tags to AutomationComponent children
    // Aspects.of(this).add(new AutomationComponentAspect(props?.standardTags?.suppressTagging));
  }
}
