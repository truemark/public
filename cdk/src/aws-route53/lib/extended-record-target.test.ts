import {
  type AliasRecordTargetConfig,
  ARecord,
  type CfnRecordSet,
  HostedZone,
  type IAliasRecordTarget,
  type IHostedZone,
  type IRecordSet,
} from 'aws-cdk-lib/aws-route53';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {ExtendedRecordTarget, LatencyARecord, WeightedARecord} from '../index';

class TestAliasRecordTarget implements IAliasRecordTarget {
  bind(_record: IRecordSet, _zone?: IHostedZone): AliasRecordTargetConfig {
    return {
      hostedZoneId: 'Z000000000000000O0000',
      dnsName: 'example',
    };
  }
}

test('Test fromAlias', () => {
  const stack = HelperTest.stack();

  const zone = new HostedZone(stack, 'Zone', {
    zoneName: 'example.com',
  });

  const target = ExtendedRecordTarget.fromAlias(
    new TestAliasRecordTarget(),
    true,
  );

  const weightedRecord = new WeightedARecord(stack, 'Weighted', {
    target,
    zone,
    weight: 1,
  });
  let rs = weightedRecord.node.defaultChild as CfnRecordSet;
  expect(rs.aliasTarget).toEqual({
    hostedZoneId: 'Z000000000000000O0000',
    dnsName: 'example',
    evaluateTargetHealth: true,
  });

  const latencyRecord = new LatencyARecord(stack, 'Latency', {
    target,
    zone,
  });
  rs = latencyRecord.node.defaultChild as CfnRecordSet;
  expect(rs.aliasTarget).toEqual({
    hostedZoneId: 'Z000000000000000O0000',
    dnsName: 'example',
    evaluateTargetHealth: true,
  });

  const simpleRecord = new ARecord(stack, 'Simple', {
    target,
    zone,
  });
  rs = simpleRecord.node.defaultChild as CfnRecordSet;
  expect(rs.aliasTarget).toEqual({
    hostedZoneId: 'Z000000000000000O0000',
    dnsName: 'example',
    evaluateTargetHealth: true,
  });
});
