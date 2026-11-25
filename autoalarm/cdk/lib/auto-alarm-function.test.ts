import {describe, expect, test} from 'vitest';
import {App, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {functionLogName} from './auto-alarm-function';

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
