import {IOrigin} from 'aws-cdk-lib/aws-cloudfront';
import {
  OriginGroup,
  OriginGroupProps,
} from 'aws-cdk-lib/aws-cloudfront-origins';

export class ExtendedOriginGroup extends OriginGroup {
  readonly primaryOrigin: IOrigin;
  readonly fallbackOrigin: IOrigin;
  readonly fallbackStatusCodes?: number[];
  constructor(props: OriginGroupProps) {
    super(props);
    this.primaryOrigin = props.primaryOrigin;
    this.fallbackOrigin = props.fallbackOrigin;
    this.fallbackStatusCodes = props.fallbackStatusCodes;
  }
}

export function isExtendedOriginGroup(
  origin: IOrigin,
): origin is ExtendedOriginGroup {
  return (
    (origin as ExtendedOriginGroup).primaryOrigin !== undefined &&
    (origin as ExtendedOriginGroup).fallbackOrigin !== undefined
  );
}
