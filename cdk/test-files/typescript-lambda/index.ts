import {APIGatewayProxyEventV2, APIGatewayProxyResultV2} from 'aws-lambda';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function main(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return {
    body: JSON.stringify({message: 'Success'}),
    statusCode: 200,
  };
}
