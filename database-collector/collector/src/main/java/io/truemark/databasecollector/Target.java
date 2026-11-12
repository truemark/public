package io.truemark.databasecollector;

/**
 * One database to collect from, with everything needed to connect except the password.
 *
 * @param id identifies the database in logs and metric dimensions
 * @param username database user, or null when it comes from the secret
 * @param secretId secret holding the credentials, or null to authenticate with IAM
 */
public record Target(
    String id,
    Engine engine,
    String host,
    int port,
    String database,
    String username,
    String secretId,
    Tls tls) {

  String jdbcUrl() {
    return engine.jdbcUrl(host, port, database);
  }
}
