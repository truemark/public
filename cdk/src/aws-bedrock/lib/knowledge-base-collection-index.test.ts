import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest} from '../../helper.test';
import {KnowledgeBaseCollectionIndex} from './knowledge-base-collection-index';

test('Test KnowledgeBaseCollectionIndex', () => {
  const stack = HelperTest.stack();
  new KnowledgeBaseCollectionIndex(stack, 'TestIndex', {
    indexName: 'test-index',
    openSearchEndpoint: 'https://test-endpoint',
    metadataFieldName: 'metadata',
    textFieldName: 'text',
    vectorFieldName: 'vector',
    vectorFieldDimension: 1024,
  });
  const template = Template.fromStack(stack);
  // HelperTest.logTemplate(template);
  template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
});
