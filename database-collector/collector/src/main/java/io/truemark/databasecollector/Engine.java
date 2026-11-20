package io.truemark.databasecollector;

import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

/** Database engines the collector can connect to. */
public enum Engine {
  POSTGRESQL("postgresql", 5432, "postgres") {
    @Override
    String jdbcUrl(String host, int port, String database, Tls tls) {
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
  // information_schema is the one schema every user may connect to.
  MYSQL("mysql", 3306, "information_schema") {
    @Override
    String jdbcUrl(String host, int port, String database, Tls tls) {
      return "jdbc:mariadb://" + host + ":" + port + "/" + database;
    }

    @Override
    Properties connectionProperties(Tls tls) {
      Properties props = new Properties();
      // Shown as program_name in performance_schema.session_connect_attrs, like ApplicationName.
      props.setProperty("connectionAttributes", "program_name:" + APPLICATION_NAME);
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
  },

  /**
   * Oracle Database. The database is the service name, which on RDS is the DB name ({@code ORCL}
   * unless another was chosen), or the PDB name for a multitenant instance.
   */
  ORACLE("oracle", 1521, "ORCL") {
    @Override
    String jdbcUrl(String host, int port, String database, Tls tls) {
      // TLS needs a TCPS listener, which RDS opens (on port 2484 by default) when the SSL option
      // is added to the instance's option group.
      String protocol = tls == Tls.VERIFY ? "tcps" : "tcp";
      return "jdbc:oracle:thin:@" + protocol + "://" + host + ":" + port + "/" + database;
    }

    @Override
    Properties connectionProperties(Tls tls) {
      Properties props = new Properties();
      // Shown as the program column of v$session.
      props.setProperty("v$session.program", APPLICATION_NAME);
      props.setProperty(
          "oracle.net.CONNECT_TIMEOUT", String.valueOf(CONNECT_TIMEOUT_SECONDS * 1000));
      props.setProperty("oracle.jdbc.ReadTimeout", String.valueOf(SOCKET_TIMEOUT_SECONDS * 1000));
      switch (tls) {
        // Uses the JVM default trust store, which TrustStore extends with the RDS CAs.
        case VERIFY -> props.setProperty("oracle.net.ssl_server_dn_match", "true");
        // Oracle native network encryption, which needs no certificate. On RDS it needs the
        // NATIVE_NETWORK_ENCRYPTION option unless the server already accepts it.
        case ENCRYPT -> {
          props.setProperty("oracle.net.encryption_client", "REQUIRED");
          props.setProperty("oracle.net.encryption_types_client", "(AES256,AES192,AES128)");
          props.setProperty("oracle.net.crypto_checksum_client", "REQUIRED");
          props.setProperty("oracle.net.crypto_checksum_types_client", "(SHA256,SHA384,SHA512)");
        }
        case OFF -> {}
      }
      return props;
    }

    /**
     * Empty: Oracle has no read-only switch that lasts for a whole session on the versions RDS runs
     * (a read-only transaction would freeze what dictionary views show), so writes are prevented by
     * granting the monitoring user nothing but read access.
     */
    @Override
    List<String> sessionSetup() {
      return List.of();
    }

    @Override
    boolean supportsIamAuthentication() {
      return false;
    }

    @Override
    boolean isLoginRejected(SQLException e) {
      // ORA-01017 invalid credentials, ORA-28000 account locked, ORA-28001 password expired.
      return super.isLoginRejected(e) || List.of(1017, 28000, 28001).contains(e.getErrorCode());
    }
  },

  /** Microsoft SQL Server. */
  SQLSERVER("sqlserver", 1433, "master") {
    @Override
    String jdbcUrl(String host, int port, String database, Tls tls) {
      return "jdbc:sqlserver://" + host + ":" + port + ";databaseName=" + database;
    }

    @Override
    Properties connectionProperties(Tls tls) {
      Properties props = new Properties();
      // Shown as program_name in sys.dm_exec_sessions.
      props.setProperty("applicationName", APPLICATION_NAME);
      props.setProperty("loginTimeout", String.valueOf(CONNECT_TIMEOUT_SECONDS));
      props.setProperty("socketTimeout", String.valueOf(SOCKET_TIMEOUT_SECONDS * 1000));
      // Uses the JVM default trust store, which TrustStore extends with the RDS CAs, and checks
      // the certificate against the host name.
      props.setProperty("encrypt", tls == Tls.OFF ? "false" : "true");
      props.setProperty("trustServerCertificate", tls == Tls.ENCRYPT ? "true" : "false");
      return props;
    }

    /**
     * Empty: SQL Server has no read-only session setting, so writes are prevented by granting the
     * monitoring login nothing but read access.
     */
    @Override
    List<String> sessionSetup() {
      return List.of();
    }

    @Override
    boolean supportsIamAuthentication() {
      return false;
    }

    @Override
    boolean isLoginRejected(SQLException e) {
      // 18456 is "Login failed for user", whatever the reason (wrong password, disabled login).
      return super.isLoginRejected(e) || e.getErrorCode() == 18456;
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

  abstract String jdbcUrl(String host, int port, String database, Tls tls);

  abstract Properties connectionProperties(Tls tls);

  /**
   * Statements run once on every new connection. They make the session read-only where the engine
   * can.
   */
  abstract List<String> sessionSetup();

  /** Whether RDS IAM database authentication tokens can be used to log in. */
  boolean supportsIamAuthentication() {
    return true;
  }

  /**
   * Whether a login failed because the credentials were rejected. The default is SQLState class 28
   * (invalid authorization), which PostgreSQL reports as 28P01 or 28000 and MariaDB Connector/J as
   * 28000.
   */
  boolean isLoginRejected(SQLException e) {
    return e.getSQLState() != null && e.getSQLState().startsWith("28");
  }

  /**
   * Parses an engine name as RDS and RDS secrets spell it, for example {@code postgres}, {@code
   * aurora-postgresql}, {@code mysql}, {@code mariadb}, {@code oracle-ee}, {@code oracle-se2-cdb}
   * or {@code sqlserver-se}. {@code aurora} is the legacy name of Aurora MySQL 5.6.
   */
  static Engine parse(String name) {
    String value = name.toLowerCase(Locale.ROOT);
    if (value.contains("postgres")) {
      return POSTGRESQL;
    }
    if (value.contains("oracle")) {
      return ORACLE;
    }
    if (value.contains("sqlserver")) {
      return SQLSERVER;
    }
    if (value.contains("mysql") || value.contains("mariadb") || value.equals("aurora")) {
      return MYSQL;
    }
    throw new IllegalArgumentException("Unsupported database engine: " + name);
  }
}
