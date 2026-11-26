import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {ListTagsCommand, OpenSearchClient} from '@aws-sdk/client-opensearch';
import {manageServiceAlarms} from '../alarm-configs/utils/service-helpers.mjs';
import {parseOSEventAndCreateAlarms} from './opensearch-modules.mjs';

vi.mock('../alarm-configs/utils/service-helpers.mjs', async (original) => ({
  ...(await original<
    typeof import('../alarm-configs/utils/service-helpers.mjs')
  >()),
  manageServiceAlarms: vi.fn(),
}));

const ACCOUNT_ID = '123456789012';
const DOMAIN_ARN = `arn:aws:es:us-west-2:${ACCOUNT_ID}:domain/orders-search`;

/**
 * Shaped like the event EventBridge delivers for a CreateDomain call:
 * CloudTrail writes the response's DomainStatus.ARN as domainStatus.aRN.
 */
function createDomainEvent(detail: Record<string, unknown>) {
  return {
    'source': 'aws.es',
    'detail-type': 'AWS API Call via CloudTrail',
    'account': ACCOUNT_ID,
    'detail': {
      eventSource: 'es.amazonaws.com',
      eventName: 'CreateDomain',
      requestParameters: {domainName: 'orders-search'},
      ...detail,
    },
  };
}

describe('OpenSearch CreateDomain events', () => {
  let send: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    send = vi.spyOn(OpenSearchClient.prototype, 'send').mockResolvedValue({
      TagList: [{Key: 'autoalarm:enabled', Value: 'true'}],
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(manageServiceAlarms).mockClear();
  });

  test('a created domain is read from domainStatus.aRN and its alarms are managed', async () => {
    const event = createDomainEvent({
      responseElements: {
        domainStatus: {aRN: DOMAIN_ARN, domainName: 'orders-search'},
        isOpenSearchDomain: true,
      },
    });

    const result = await parseOSEventAndCreateAlarms(event);

    expect(result.domainArn).toBe(DOMAIN_ARN);
    const command = send.mock.calls[0][0] as ListTagsCommand;
    expect(command.input).toEqual({ARN: DOMAIN_ARN});
    expect(manageServiceAlarms).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'OS',
        identifier: 'orders-search',
        tags: {'autoalarm:enabled': 'true'},
      }),
    );
  });

  test('the ARN is still read from domain.arn when domainStatus is absent', async () => {
    const event = createDomainEvent({
      responseElements: {domain: {arn: DOMAIN_ARN}},
    });

    const result = await parseOSEventAndCreateAlarms(event);

    expect(result.domainArn).toBe(DOMAIN_ARN);
  });

  test('a failed CreateDomain call is skipped', async () => {
    const event = createDomainEvent({
      errorCode: 'AccessDenied',
      responseElements: null,
    });

    await expect(parseOSEventAndCreateAlarms(event)).resolves.toMatchObject({
      domainArn: '',
    });
    expect(send).not.toHaveBeenCalled();
    expect(manageServiceAlarms).not.toHaveBeenCalled();
  });

  test('a successful CreateDomain event with no ARN fails the record', async () => {
    const event = createDomainEvent({responseElements: {}});

    await expect(parseOSEventAndCreateAlarms(event)).rejects.toThrow(
      'Resolved OpenSearch domain name is empty',
    );
  });
});
