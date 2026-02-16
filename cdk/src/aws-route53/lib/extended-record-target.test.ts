import {ExtendedRecordTarget, LatencyARecord, WeightedARecord} from '../index';
import {
  AliasRecordTargetConfig,
  ARecord,
  CfnRecordSet,
  HostedZone,
  IAliasRecordTarget,
  IHostedZone,
  IRecordSet,
} from 'aws-cdk-lib/aws-route53';
import {HelperTest} from '../../helper.test';

class TestAliasRecordTarget implements IAliasRecordTarget {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  bind(record: IRecordSet, zone?: IHostedZone): AliasRecordTargetConfig {
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
