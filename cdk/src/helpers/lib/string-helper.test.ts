import {
  isCamelCase,
  isPascalCase,
  toSnakeCase,
  toKebabCase,
  toCamelCase,
  toPascalCase,
  isLowerAlphanumeric,
  isUpperAlphanumeric,
} from './string-helper';

test('Test StringHelper#isCamelCase', () => {
  expect(isCamelCase(undefined)).toBe(false);
  expect(isCamelCase(null)).toBe(false);
  expect(isCamelCase('testThis')).toBe(true);
  expect(isCamelCase('testThis01')).toBe(true);
  expect(isCamelCase('TestThis')).toBe(false);
  expect(isCamelCase('test-this')).toBe(false);
});

test('Test StringHelper#isPascalCase', () => {
  expect(isPascalCase(undefined)).toBe(false);
  expect(isPascalCase(null)).toBe(false);
  expect(isPascalCase('TestThis')).toBe(true);
  expect(isPascalCase('TestThis01')).toBe(true);
  expect(isPascalCase('testThis')).toBe(false);
  expect(isPascalCase('Test-This')).toBe(false);
});

test('Test toSnakeCase', () => {
  expect(toSnakeCase('ThisIsATest')).toBe('this_is_a_test');
  expect(toSnakeCase('This_Is_A_Test')).toBe('this_is_a_test');
  expect(toSnakeCase('This-Is-A-Test')).toBe('this_is_a_test');
  expect(toSnakeCase('This Is A Test')).toBe('this_is_a_test');
});

test('Test toKebabCase', () => {
  expect(toKebabCase('ThisIsATest')).toBe('this-is-a-test');
  expect(toKebabCase('This_Is_A_Test')).toBe('this-is-a-test');
  expect(toKebabCase('This-Is-A-Test')).toBe('this-is-a-test');
  expect(toKebabCase('This Is A Test')).toBe('this-is-a-test');
});

test('Test toCamelCase', () => {
  expect(toCamelCase('this-is-a-test')).toBe('thisIsATest');
  expect(toCamelCase('this_is_a_Test')).toBe('thisIsATest');
  expect(toCamelCase('ThisIsATest')).toBe('thisIsATest');
  expect(toCamelCase('This Is A Test')).toBe('thisIsATest');
});

test('Test toPascalCase', () => {
  expect(toPascalCase('this_is_a_test')).toBe('ThisIsATest');
  expect(toPascalCase('this_is_a_Test')).toBe('ThisIsATest');
  expect(toPascalCase('ThisIsATest')).toBe('ThisIsATest');
  expect(toPascalCase('this is a test')).toBe('ThisIsATest');
  expect(toPascalCase('dev')).toBe('Dev');
});

test('Test isLowerAlphanumeric', () => {
  expect(isLowerAlphanumeric(undefined)).toBe(false);
  expect(isLowerAlphanumeric(null)).toBe(false);
  expect(isLowerAlphanumeric('test1234')).toBe(true);
  expect(isLowerAlphanumeric('Test1234')).toBe(false);
});

test('Test isUpperAlphaNumeric', () => {
  expect(isUpperAlphanumeric(undefined)).toBe(false);
  expect(isUpperAlphanumeric(null)).toBe(false);
  expect(isUpperAlphanumeric('test1234')).toBe(false);
  expect(isUpperAlphanumeric('Test1234')).toBe(false);
  expect(isUpperAlphanumeric('TEST1234')).toBe(true);
});
