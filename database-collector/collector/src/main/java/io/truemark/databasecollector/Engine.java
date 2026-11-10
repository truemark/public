package io.truemark.databasecollector;

import java.util.List;
import java.util.Locale;
import java.util.Properties;

/** Database engines the collector can connect to. */
public enum Engine {
  POSTGRESQL("postgresql", 5432, "postgres") {
    @Override
    String jdbcUrl(String host, int port, String database) {
      return "jdbc:postgresql://" + host + ":" + port + "/" + database;
    }

    @Override
    Properties connectionProperties(Tls tls) {
      Properties props = new Properties();
      props.setProperty("ApplicationName", APPLICATION_NAME);
      props.setProperty("connectTimeout", String.valueOf(CONNECT_TIMEOUT_SECONDS));
      props.setProperty("socketTimeout", String.valueOf(SOCKET_TIMEOUT_SECONDS));
      switch (tls) {
        case VERIFY -> {
          props.setProperty("sslmode", "verify-full");
          // Uses the JVM default trust store, which TrustStore extends with the RDS CAs.
          props.setProperty("sslfactory", "org.postgresql.ssl.DefaultJavaSSLFactory");
        }
        case ENCRYPT -> {
          props.setProperty("sslmode", "require");
          props.setProperty("sslfactory", "org.postgresql.ssl.NonValidatingFactory");
        }
        case OFF -> props.setProperty("sslmode", "disable");
      }
      return props;
    }

    @Override
    List<String> sessionSetup() {
      return List.of("SET default_transaction_read_only = on");
    }
  },

  /** MySQL and MariaDB, both reached through the MariaDB driver. */
  MYSQL("mysql", 3306, "mysql") {
    @Override
    String jdbcUrl(String host, int port, String database) {
      return "jdbc:mariadb://" + host + ":" + port + "/" + database;
    }

    @Override
    Properties connectionProperties(Tls tls) {
      Properties props = new Properties();
      props.setProperty("connectTimeout", String.valueOf(CONNECT_TIMEOUT_SECONDS * 1000));
      props.setProperty("socketTimeout", String.valueOf(SOCKET_TIMEOUT_SECONDS * 1000));
      props.setProperty(
          "sslMode",
          switch (tls) {
            case VERIFY -> "verify-full";
            case ENCRYPT -> "trust";
            case OFF -> "disable";
          });
      return props;
    }

    @Override
    List<String> sessionSetup() {
      return List.of("SET SESSION TRANSACTION READ ONLY");
    }
  };

  static final String APPLICATION_NAME = "database-collector";
  private static final int CONNECT_TIMEOUT_SECONDS = 5;
  private static final int SOCKET_TIMEOUT_SECONDS = 30;

  private final String id;
  private final int defaultPort;
  private final String defaultDatabase;

  Engine(String id, int defaultPort, String defaultDatabase) {
    this.id = id;
    this.defaultPort = defaultPort;
    this.defaultDatabase = defaultDatabase;
  }

  /** Name used in logs, metric dimensions and built-in query file names. */
  public String id() {
    return id;
  }

  int defaultPort() {
    return defaultPort;
  }

  String defaultDatabase() {
    return defaultDatabase;
  }

  abstract String jdbcUrl(String host, int port, String database);

  abstract Properties connectionProperties(Tls tls);

  /** Statements run once on every new connection. They make the session read-only. */
  abstract List<String> sessionSetup();

  /**
   * Parses an engine name as RDS and RDS secrets spell it, for example {@code postgres}, {@code
   * aurora-postgresql}, {@code mysql} or {@code mariadb}.
   */
  static Engine parse(String name) {
    String value = name.toLowerCase(Locale.ROOT);
    if (value.contains("postgres")) {
      return POSTGRESQL;
    }
    if (value.contains("mysql") || value.contains("mariadb")) {
      return MYSQL;
    }
    throw new IllegalArgumentException("Unsupported database engine: " + name);
  }
}
