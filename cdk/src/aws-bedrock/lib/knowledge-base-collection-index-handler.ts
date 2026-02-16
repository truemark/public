import {Client} from '@opensearch-project/opensearch';
import {AwsSigv4Signer} from '@opensearch-project/opensearch/aws';
import {defaultProvider} from '@aws-sdk/credential-provider-node';
import * as crypto from 'crypto';

// See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-requests.html
interface CustomResourceEvent {
  readonly RequestType: 'Create' | 'Update' | 'Delete';
  readonly ResponseURL: string;
  readonly StackId: string;
  readonly RequestId: string;
  readonly ResourceType: string;
  readonly LogicalResourceId: string;
  readonly PhysicalResourceId?: string; // Not sent for 'Create' requests
  readonly ResourceProperties: Record<string, string>;
  readonly OldResourceProperties?: Record<string, string>;
}

// See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-responses.html
interface CustomResourceResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string; // Required if status is FAILED
  PhysicalResourceId?: string; // If the value returned is the same, it is considered a normal update. If the value returned is different, AWS CloudFormation recognizes the update as a replacement and sends a delete request to the old resource.
  StackId: string; // This response value should be copied verbatim from the request.
  RequestId: string; // This response value should be copied verbatim from the request.
  LogicalResourceId: string; //  This response value should be copied verbatim from the request.
  NoEcho?: boolean; // If the value is true, the AWS CloudFormation doesn't include the resource property value in the response.
  Data?: Record<string, string>; // A map of key-value pairs that represent the output data of the custom resource provider.
}

function success(
  event: CustomResourceEvent,
  physicalResourceId: string,
  indexName: string,
): CustomResourceResponse {
  return {
    Status: 'SUCCESS',
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {
      IndexName: indexName,
    },
  };
}

function fail(
  event: CustomResourceEvent,
  physicalResourceId: string,
  reason: string,
  indexName: string,
): CustomResourceResponse {
  return {
    Status: 'FAILED',
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {
      IndexName: indexName,
    },
  };
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function handler(
  event: CustomResourceEvent,
): Promise<CustomResourceResponse> {
  console.log('Received event', JSON.stringify(event, null, 2));
  // Initialize variables
  const endpoint = event.ResourceProperties.openSearchEndpoint;
  const indexName = event.ResourceProperties.indexName;
  const physicalResourceId = hash(endpoint + '/' + indexName);
  const metadataFieldName = event.ResourceProperties.metadataFieldName;
  const textFieldName = event.ResourceProperties.textFieldName;
  const vectorFieldName = event.ResourceProperties.vectorFieldName;
  const vectorFieldDimension = parseInt(
    event.ResourceProperties.vectorFieldDimension,
  );
  if (isNaN(vectorFieldDimension)) {
    console.error('vectorFieldDimension must be a number');
    return fail(
      event,
      physicalResourceId,
      'vectorFieldDimension must be a number',
      indexName,
    );
  }
  const region = process.env['AWS_REGION'];
  if (!region) {
    console.error('AWS_REGION environment variable is required');
    return fail(
      event,
      physicalResourceId,
      'AWS_REGION environment variable is required',
      indexName,
    );
  }

  // We don't support updates or deletes right now so return success
  if (event.RequestType === 'Delete' || event.RequestType === 'Update') {
    console.log('Ignoring request type', event.RequestType);
    return success(event, physicalResourceId, indexName);
  }

  const client = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'aoss',
      getCredentials: () => {
        // Any other method to acquire a new Credentials object can be used.
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: endpoint,
  });

  try {
    // If endpoint exists, return success and move on
    const indexExists = await client.indices.exists({index: indexName});
    if (indexExists.body) {
      console.log('Index already exists');
      return success(event, physicalResourceId, indexName);
    }
    // See https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-vector-search.html
    const createResponse = await client.indices.create({
      index: indexName,
      body: {
        settings: {
          index: {
            knn: true,
          },
        },
        mappings: {
          properties: {
            [vectorFieldName]: {
              type: 'knn_vector',
              dimension: vectorFieldDimension,
              method: {
                engine: 'faiss',
                name: 'hnsw',
              },
            },
            [textFieldName]: {
              type: 'text',
            },
            [metadataFieldName]: {
              type: 'keyword',
            },
          },
        },
      },
    });
    if (createResponse.statusCode !== 200) {
      console.error(
        'Failed to create index:',
        createResponse.body.error.reason,
      );
      return fail(
        event,
        physicalResourceId,
        `Failed to create index: ${createResponse.body.error.reason}`,
        indexName,
      );
    }

    let count = 0;
    do {
      count++;
      try {
        const getResponse = await client.indices.get({index: indexName});
        if (getResponse.statusCode === 200) {
          console.log(
            'Retrieved index successfully',
            JSON.stringify(getResponse.body, null, 2),
          );
          // For some reason even though the index is created, we need to wait or we get a 403 error on the Bedrock Knowledge Base
          await new Promise((resolve) => setTimeout(resolve, 15000));
          return success(event, physicalResourceId, indexName);
        }
      } catch (e) {
        if (e instanceof Error) {
          if (e.message.includes('index_not_found_exception')) {
            console.log(`Attempt ${count} - Index not yet created`);
          } else {
            return fail(event, physicalResourceId, e.message, indexName);
          }
        } else {
          return fail(event, physicalResourceId, 'Error: ' + e, indexName);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } while (count < 80); // Tries up to 4 minutes 80 * 3000 / 1000 / 60 =4
    return fail(
      event,
      physicalResourceId,
      'Timed out waiting for index creation. Manual intervention may be necessary.',
      indexName,
    );
  } catch (e) {
    return e instanceof Error
      ? fail(event, physicalResourceId, e.message, indexName)
      : fail(event, physicalResourceId, 'Error: ' + e, indexName);
  }
}
