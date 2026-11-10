package io.truemark.databasecollector;

/** Reads the text of a secret. */
@FunctionalInterface
public interface SecretSource {
  String get(String secretId);
}
