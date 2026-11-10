/** Default prefix for every tag Database Collector reads. */
export const DEFAULT_TAG_PREFIX = 'database-collector:';

/**
 * Tag names, without the prefix, that Database Collector reads from RDS
 * instances and Secrets Manager secrets.
 */
export const TAG_NAMES = [
  'enabled',
  'secret',
  'username',
  'database',
  'query-sets',
] as const;

export type TagName = (typeof TAG_NAMES)[number];

/** Returns the full tag keys for the given prefix. */
export function tagKeys(prefix: string = DEFAULT_TAG_PREFIX): string[] {
  return TAG_NAMES.map((name) => `${prefix}${name}`);
}
