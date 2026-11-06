import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import {SQSEvent, SQSRecord, Handler, SQSBatchResponse} from 'aws-lambda';
import * as logging from '@nr1e/logging';
import * as crypto from 'crypto';

// Initialize logging
const level = process.env.LOG_LEVEL || 'info';
if (!logging.isLevel(level)) {
  throw new Error(`Invalid log level: ${level}`);
}
const log = logging.initialize({
  svc: 'AutoAlarm',
  name: 'sqs-handler',
  level,
});

// Initialize SQS client
const sqsClient = new SQSClient({region: process.env.AWS_REGION});

// Get the target FIFO queue URL from environment variables
const targetQueueUrl = process.env.TARGET_FIFO_QUEUE_URL;

if (!targetQueueUrl) {
  throw new Error('TARGET_FIFO_QUEUE_URL environment variable is required');
}

// No service-specific functions needed

// Function to process a single SQS record
async function processRecord(record: SQSRecord): Promise<boolean> {
  try {
    // Log the message being processed
    log.info().str('messageId', record.messageId).msg('Processing message');

    // Create a hash of the message body to use as a unique identifier
    const messageHash = crypto
      .createHash('sha256')
      .update(record.body)
      .digest('hex')
      .substring(0, 8);

    /*
     * EC2 messages MUST keep their original MessageGroupId so they remain
     * strictly serialized on the target FIFO queue. The EC2 path manages AMP
     * (Amazon Managed Prometheus) rule groups namespaces via a
     * read-modify-write (DescribeRuleGroupsNamespace -> mutate in memory ->
     * PutRuleGroupsNamespace), and the AMP API has no conditional put.
     * Appending the hash suffix lets these messages process concurrently,
     * which causes lost updates (whole-namespace replaces clobber each other
     * and silently drop rules). EC2 is the only service using the Prometheus
     * path; all other services keep the hash suffix for parallelism, which is
     * safe for them. Message bodies are unchanged, so contentBasedDeduplication
     * behavior on the target FIFO queue is unaffected.
     */
    const originalMessageGroupId = record.attributes.MessageGroupId;
    const isEc2Message =
      originalMessageGroupId?.toLowerCase() === 'autoalarm-ec2';

    // Create a unique message group ID by appending the hash to the message ID
    const messageGroupId = isEc2Message
      ? originalMessageGroupId
      : `${originalMessageGroupId}-${messageHash}`;

    // Log routing details
    log
      .debug()
      .str('messageId', record.messageId)
      .str('targetQueue', targetQueueUrl)
      .str('messageGroupId', messageGroupId)
      .msg('Routing message to target FIFO queue');

    // Prepare the message to send to the target queue
    const sendParams: SendMessageCommandInput = {
      QueueUrl: targetQueueUrl,
      MessageBody: record.body, // Forward the original message unchanged
      MessageGroupId: messageGroupId,
    };

    // Send the message to the target queue
    const response = await sqsClient.send(new SendMessageCommand(sendParams));

    // Log success
    log
      .info()
      .str('messageId', record.messageId)
      .str('newMessageId', response.MessageId || 'unknown')
      .str('messageGroupId', messageGroupId)
      .msg('Successfully routed message to target FIFO queue');

    return true;
  } catch (error) {
    // Log error
    log
      .error()
      .str('messageId', record.messageId)
      .err(error)
      .msg('Error processing message');

    return false;
  }
}

// Lambda handler
export const handler: Handler = async (
  event: SQSEvent,
): Promise<void | SQSBatchResponse> => {
  log
    .trace()
    .obj('event', event)
    .num('recordCount', event.Records.length)
    .msg('Received SQS event batch');

  const batchItemFailures: {itemIdentifier: string}[] = [];

  // Process each record in the batch
  await Promise.allSettled(
    event.Records.map(async (record: SQSRecord) => {
      const success = await processRecord(record);

      if (!success) {
        // If processing failed, add to failures list
        batchItemFailures.push({itemIdentifier: record.messageId});
        log
          .warn()
          .str('messageId', record.messageId)
          .msg('Adding message to batch item failures');
      }
    }),
  );

  // Return report of failed messages
  log
    .info()
    .num('processedCount', event.Records.length)
    .num('failureCount', batchItemFailures.length)
    .msg('Completed processing message batch');

  return {batchItemFailures};
};
