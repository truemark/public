import {DomainName} from '../index';

test('Test propsMatch', () => {
  const domainName = new DomainName({
    prefix: 'test1',
    zone: 'example.com',
  });
  let match = domainName.propsMatch({
    prefix: 'test1',
    zone: 'example.com',
  });
  expect(match).toBe(true);
  match = domainName.propsMatch({
    prefix: 'test1',
    zone: 'example.com',
    privateZone: false,
  });
  expect(match).toBe(true);
  match = domainName.propsMatch({
    prefix: 'test1',
    zone: 'example.com',
    privateZone: true,
  });
  expect(match).toBe(false);
  match = domainName.propsMatch({
    prefix: 'test2',
    zone: 'example.com',
  });
  expect(match).toBe(false);
});

test('Test findDomainName', () => {
  const domainName1 = new DomainName({
    prefix: 'test1',
    zone: 'example.com',
  });
  const domainName2 = new DomainName({
    prefix: 'test2',
    zone: 'example.com',
  });
  const domainName3 = new DomainName({
    prefix: 'test3',
    zone: 'example.com',
    privateZone: true,
  });
  const foundDomainName = DomainName.findDomainName(
    {prefix: 'test2', zone: 'example.com'},
    [domainName1, domainName2, domainName3],
  );
  expect(foundDomainName).toBeDefined();
  expect(foundDomainName?.getPrefix()).toEqual('test2');
  expect(foundDomainName?.getZone()).toEqual('example.com');
});

test('Test fromFqdn', () => {
  const domainName1 = DomainName.fromFqdn('www.example.com', 'example.com');
  expect(domainName1.getPrefix()).toEqual('www');
  expect(domainName1.getZone()).toEqual('example.com');
});
