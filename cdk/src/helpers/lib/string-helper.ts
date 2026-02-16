/**
 * Tests if a string is lower case alphanumeric
 *
 * @param str the string to check
 */
export function isLowerAlphanumeric(str?: string | null): boolean {
  if (str) {
    return /^[a-z0-9]+$/.test(str);
  }
  return false;
}

/**
 * Tests if a string is upper case alphanumeric.
 *
 * @param str the string to check
 */
export function isUpperAlphanumeric(str?: string | null): boolean {
  if (str) {
    return /^[A-Z0-9]+$/.test(str);
  }
  return false;
}

/**
 * Tests if a string is PascalCase.
 *
 * @param str the string to test
 */
export function isPascalCase(str?: string | null) {
  if (str) {
    return /^[A-Z](([a-z0-9]+[A-Z]?)*)$/.test(str);
  }
  return false;
}

/**
 * Tests if a string is camelCase.
 *
 * @param str the string to test
 */
export function isCamelCase(str?: string | null) {
  if (str) {
    return /^[a-z][a-z0-9]*(([A-Z][a-z0-9]+)*[A-Z]?|([a-z0-9]+[A-Z])*|[A-Z])$/.test(
      str,
    );
  }
  return false;
}

/**
 * Converts a string to snake_case
 *
 * @param str the string to convert
 */
export function toSnakeCase(str: string): string {
  return (
    str.match(
      /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
    ) || []
  )
    .map((x) => x.toLowerCase())
    .join('_');
}

/**
 * Converts a string to kebab-case
 *
 * @param str the string to convert
 */
export function toKebabCase(str: string): string {
  return (
    str.match(
      /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
    ) || []
  )
    .map((x) => x.toLowerCase())
    .join('-');
}

/**
 * Converts a string to camelCase.
 *
 * @param str the string to convert
 */
export function toCamelCase(str: string): string {
  str = toPascalCase(str);
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Converts a string to PascalCase.
 *
 * @param str the string to convert
 */
export function toPascalCase(str: string): string {
  return (str.match(/[a-zA-Z0-9]+/g) || [])
    .map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`)
    .join('');
}
