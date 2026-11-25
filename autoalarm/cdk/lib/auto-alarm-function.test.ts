import {describe, expect, test} from 'vitest';
import {App, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {ERROR_LOG_PATTERN, functionLogName} from './auto-alarm-function';

describe('functionLogName', () => {
  test('differs for the same function id under different parents', () => {
    const stack = new Stack(new App(), 'Test');
    const first = functionLogName(new Construct(stack, 'First'), 'Handler');
    const second = functionLogName(new Construct(stack, 'Second'), 'Handler');
    expect(first).toMatch(/^Test-Handler-[0-9A-F]{8}$/);
    expect(second).toMatch(/^Test-Handler-[0-9A-F]{8}$/);
    expect(first).not.toBe(second);
  });

  test('is stable across synths', () => {
    const name = () => functionLogName(new Stack(new App(), 'Test'), 'Handler');
    expect(name()).toBe(name());
  });

  test('keeps the hash when the stack name is long', () => {
    const stack = new Stack(new App(), 'Test', {stackName: 'A'.repeat(128)});
    expect(functionLogName(stack, 'Handler')).toMatch(/-Handler-[0-9A-F]{8}$/);
  });
});

/**
 * Runs the pattern as a JavaScript regex. CloudWatch has its own engine, so
 * this shows which lines the expression is meant to match and guards against
 * an edit that changes that; it does not prove what CloudWatch does with it.
 */
describe('ERROR_LOG_PATTERN', () => {
  const regex = new RegExp(ERROR_LOG_PATTERN.slice(1, -1));

  test('is a CloudWatch regex pattern made only of supported characters', () => {
    expect(ERROR_LOG_PATTERN).toMatch(/^%.*%$/);
    // Letters, digits, the supported symbols and operators, and \x escapes.
    expect(ERROR_LOG_PATTERN.slice(1, -1)).toMatch(
      /^[A-Za-z0-9:_#=@/;,\-^$?[\]{}|\\*+.]+$/,
    );
  });

  test.each([
    [
      'a handler error (pino level 50)',
      '{"level":50,"time":1,"svc":"AutoAlarm","name":"main-handler","msg":"Error deleting RDS alarms"}',
    ],
    ['a handler fatal (pino level 60)', '{"level":60,"time":1,"msg":"fatal"}'],
    [
      'an uncaught exception reported by the Lambda runtime',
      '{"timestamp":"2026-01-01T00:00:00Z","level":"ERROR","requestId":"r","message":{"errorType":"TypeError"}}',
    ],
    [
      'the word printed through console.log, which Lambda records at INFO',
      '{"timestamp":"2026-01-01T00:00:00Z","level":"INFO","requestId":"r","message":"ERROR: connection reset"}',
    ],
    ['a plain text line', 'ERROR something broke'],
  ])('matches %s', (_name, line) => {
    expect(regex.test(line)).toBe(true);
  });

  test.each([
    [
      'a handler info line that mentions error counts',
      '{"level":30,"time":1,"svc":"AutoAlarm","name":"realarm-producer","throttlingErrors":0,"totalErrors":0,"msg":"API call metrics summary"}',
    ],
    [
      'a handler warning',
      '{"level":40,"time":1,"msg":"Error message found in record body"}',
    ],
    [
      'a platform report',
      '{"time":"2026-01-01T00:00:00Z","type":"platform.report","record":{"status":"success"}}',
    ],
  ])('does not match %s', (_name, line) => {
    expect(regex.test(line)).toBe(false);
  });
});
