import {AwsCustomResource} from 'aws-cdk-lib/custom-resources';
import {ExtendedConstruct} from '../../aws-cdk/index';
import {Construct} from 'constructs';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import {Duration, Stack} from 'aws-cdk-lib';

export interface EcsServiceUpdateProps {
  readonly cluster: string;
  readonly service: string;
  readonly desiredCount?: number;
  readonly ignoreServiceNotFound?: boolean;
  readonly timeout?: Duration;
}

export class EcsServiceUpdate extends ExtendedConstruct {
  constructor(scope: Construct, id: string, props: EcsServiceUpdateProps) {
    super(scope, id);
    if (props.desiredCount) {
      const stack = Stack.of(this);
      new AwsCustomResource(this, '', {
        installLatestAwsSdk: false,
        onUpdate: {
          service: 'ECS',
          action: 'updateService',
          ignoreErrorCodesMatching: props.ignoreServiceNotFound
            ? '.*ServiceNotFound.*'
            : undefined,
          parameters: {
            cluster: props.cluster,
            service: props.service,
            desiredCount: props.desiredCount,
          },
          physicalResourceId: {id: Date.now().toString()},
          outputPaths: ['service.desiredCount'],
        },
        policy: {
          statements: [
            new PolicyStatement({
              resources: [
                `arn:aws:ecs:${stack.region}:${stack.account}:service/${props.cluster}/${props.service}`,
              ],
              actions: ['ecs:UpdateService'],
              effect: Effect.ALLOW,
            }),
          ],
        },
        timeout: props.timeout ?? Duration.minutes(2),
      });
    }
  }
}
