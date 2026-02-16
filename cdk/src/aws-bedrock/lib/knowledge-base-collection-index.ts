import {Construct} from 'constructs';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {CustomResource, Duration} from 'aws-cdk-lib';
import {Provider} from 'aws-cdk-lib/custom-resources';
import {Runtime} from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';

export interface CollectionIndexProps {
  readonly openSearchEndpoint: string;
  readonly indexName: string;
  readonly metadataFieldName: string;
  readonly textFieldName: string;
  readonly vectorFieldName: string;
  readonly vectorFieldDimension: number;
}

export class KnowledgeBaseCollectionIndex extends Construct {
  readonly openSearchEndpoint: string;
  readonly indexName: string;
  readonly metadataFieldName: string;
  readonly textFieldName: string;
  readonly vectorFieldName: string;
  readonly vectorFieldDimension: number;
  readonly role: Role;
  readonly resource: CustomResource;
  constructor(scope: Construct, id: string, props: CollectionIndexProps) {
    super(scope, id);

    this.openSearchEndpoint = props.openSearchEndpoint;
    this.indexName = props.indexName;
    this.metadataFieldName = props.metadataFieldName;
    this.textFieldName = props.textFieldName;
    this.vectorFieldName = props.vectorFieldName;
    this.vectorFieldDimension = props.vectorFieldDimension;

    const role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    this.role = role;
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'aoss:APIAccessAll',
        ],
        resources: ['*'],
      }),
    );

    const fn = new NodejsFunction(this, 'Function', {
      role,
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(
        __dirname,
        '..',
        '..',
        '..',
        'dist',
        'aws-bedrock',
        'lib',
        'knowledge-base-collection-index-handler.js',
      ),
      timeout: Duration.minutes(5),
    });

    const provider = new Provider(this, 'Provider', {
      onEventHandler: fn,
    });

    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        openSearchEndpoint: props.openSearchEndpoint,
        indexName: props.indexName,
        metadataFieldName: props.metadataFieldName,
        textFieldName: props.textFieldName,
        vectorFieldName: props.vectorFieldName,
        vectorFieldDimension: props.vectorFieldDimension,
        timestamp: Date.now(), // Forces re-deployment and execution of the custom resource
      },
    });
    this.resource.node.addDependency(this.resource);
  }
}
