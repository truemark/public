package io.truemark.databasecollector;

/** Creates IAM database authentication tokens. */
@FunctionalInterface
public interface TokenSource {
  String token(String host, int port, String username);
}
