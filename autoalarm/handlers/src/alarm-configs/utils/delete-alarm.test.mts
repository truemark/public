import {afterEach, describe, expect, test, vi} from 'vitest';
import {CloudWatchClient, ResourceNotFound} from '@aws-sdk/client-cloudwatch';
import * as logging from '@nr1e/logging';
import {deleteAlarm} from './alarm-tools.mjs';

// alarm-tools only gets a child logger; a handler initializes the root one.
logging.initialize({
  svc: 'AutoAlarm',
  name: 'delete-alarm-test',
  level: 'fatal',
});

describe('deleteAlarm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rejects when the alarm cannot be deleted', async () => {
    vi.spyOn(CloudWatchClient.prototype, 'send').mockRejectedValue(
      new Error('AccessDenied') as never,
    );

    await expect(deleteAlarm('AutoAlarm-test')).rejects.toThrow('AccessDenied');
  });

  test('treats an alarm that no longer exists as deleted', async () => {
    vi.spyOn(CloudWatchClient.prototype, 'send').mockRejectedValue(
      new ResourceNotFound({message: 'gone', $metadata: {}}) as never,
    );

    await expect(deleteAlarm('AutoAlarm-test')).resolves.toBeUndefined();
  });
});
