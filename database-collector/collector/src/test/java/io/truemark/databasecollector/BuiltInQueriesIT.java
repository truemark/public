package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Runs every built-in query against real databases, logged in as a monitoring user with only the
 * privileges the README asks for. Skipped when Docker is not available.
 */
@Testcontainers(disabledWithoutDocker = true)
class BuiltInQueriesIT {
  // Pulled through the Amazon ECR public mirror because Docker Hub rate-limits anonymous pulls.
  // Oracle and SQL Server images are not on the mirror, so they are named in full.
  private static final String MIRROR = "public.ecr.aws/docker/library/";
  private static final String USER = "database_collector";
  private static final String PASSWORD = "collector-test";

  // Complex enough for SQL Server's password policy.
  private static final String ADMIN_PASSWORD = "Admin-test-1";

  /**
   * A database server in a container. Plain containers are used instead of the Testcontainers
   * database modules because the MySQL module needs the MySQL driver, which is not bundled.
   */
  private record Database(
      String name,
      Engine engine,
      GenericContainer<?> container,
      String adminUser,
      String databaseName,
      Tls tls,
      List<String> setup) {
    @Override
    public String toString() {
      return name;
    }

    Target target(String username) {
      return new Target(
          name,
          engine,
          container.getHost(),
          container.getMappedPort(engine.defaultPort()),
          databaseName,
          username,
          null,
          tls);
    }
  }

  private static GenericContainer<?> container(String image, int port, String readyLog) {
    String name = image.contains("/") ? image : MIRROR + image;
    return new GenericContainer<>(DockerImageName.parse(name))
        .withExposedPorts(port)
        .waitingFor(Wait.forLogMessage(readyLog, 1));
  }

  private static final List<Database> DATABASES =
      List.of(
          new Database(
              "postgres:17",
              Engine.POSTGRESQL,
              // Logged once by the temporary server that runs the init scripts, once for real.
              container("postgres:17-alpine", 5432, ".*")
                  .waitingFor(
                      Wait.forLogMessage(".*database system is ready to accept connections.*", 2))
                  .withEnv("POSTGRES_PASSWORD", ADMIN_PASSWORD),
              "postgres",
              "postgres",
              Tls.OFF,
              List.of(
                  "CREATE USER " + USER + " PASSWORD '" + PASSWORD + "'",
                  "GRANT pg_monitor TO " + USER,
                  "CREATE TABLE writable (id int)",
                  "GRANT ALL ON writable TO " + USER)),
          new Database(
              "mysql:8.4",
              Engine.MYSQL,
              container("mysql:8.4", 3306, ".*socket: .*port: 3306 .*")
                  .withEnv("MYSQL_ROOT_PASSWORD", ADMIN_PASSWORD)
                  .withEnv("MYSQL_DATABASE", "test"),
              "root",
              "test",
              Tls.ENCRYPT,
              mysqlSetup()),
          new Database(
              "mariadb:11.4",
              Engine.MYSQL,
              container("mariadb:11.4", 3306, ".*socket: .*port: 3306 .*")
                  .withEnv("MARIADB_ROOT_PASSWORD", ADMIN_PASSWORD)
                  .withEnv("MARIADB_DATABASE", "test"),
              "root",
              "test",
              Tls.ENCRYPT,
              mysqlSetup()),
          new Database(
              "oracle-free:23",
              Engine.ORACLE,
              container(
                      "gvenzl/oracle-free:23-slim-faststart", 1521, ".*DATABASE IS READY TO USE.*")
                  .withEnv("ORACLE_PASSWORD", ADMIN_PASSWORD)
                  .withStartupTimeout(Duration.ofMinutes(5)),
              "system",
              "FREEPDB1",
              // Native network encryption, which the server accepts by default.
              Tls.ENCRYPT,
              List.of(
                  "CREATE USER " + USER + " IDENTIFIED BY \"" + PASSWORD + "\"",
                  "GRANT CREATE SESSION, SELECT_CATALOG_ROLE TO " + USER)),
          new Database(
              "sqlserver:2022",
              Engine.SQLSERVER,
              container(
                      "mcr.microsoft.com/mssql/server:2022-latest",
                      1433,
                      ".*SQL Server is now ready for client connections.*")
                  .withEnv("ACCEPT_EULA", "Y")
                  .withEnv("MSSQL_SA_PASSWORD", ADMIN_PASSWORD)
                  .withStartupTimeout(Duration.ofMinutes(5)),
              "sa",
              "master",
              // The server makes a self-signed certificate.
              Tls.ENCRYPT,
              List.of(
                  "CREATE LOGIN "
                      + USER
                      + " WITH PASSWORD = '"
                      + PASSWORD
                      + "', CHECK_POLICY = OFF",
                  "GRANT VIEW SERVER STATE, VIEW ANY DEFINITION TO " + USER,
                  "CREATE DATABASE app")));

  private static List<String> mysqlSetup() {
    return List.of(
        "CREATE USER '" + USER + "'@'%' IDENTIFIED BY '" + PASSWORD + "'",
        "GRANT PROCESS, SHOW VIEW ON *.* TO '" + USER + "'@'%'",
        "CREATE DATABASE app",
        "CREATE TABLE app.orders (id int)",
        "CREATE TABLE test.writable (id int)",
        "GRANT ALL ON test.writable TO '" + USER + "'@'%'");
  }

  /** Rows the sessions query returns: one per state it reports. */
  private static final Map<Engine, Integer> SESSION_STATES =
      Map.of(Engine.POSTGRESQL, 5, Engine.MYSQL, 2, Engine.ORACLE, 3, Engine.SQLSERVER, 4);

  static Stream<Database> databases() {
    return DATABASES.stream();
  }

  @AfterAll
  static void stop() {
    DATABASES.forEach(database -> database.container().stop());
  }

  private static Connection connect(Database database) throws SQLException {
    if (!database.container().isRunning()) {
      database.container().start();
      Target admin = database.target(database.adminUser());
      Properties props = database.engine().connectionProperties(database.tls());
      props.setProperty("user", admin.username());
      props.setProperty("password", ADMIN_PASSWORD);
      try (Connection connection = connectWithRetry(admin.jdbcUrl(), props);
          Statement statement = connection.createStatement()) {
        for (String sql : database.setup()) {
          statement.execute(sql);
        }
      }
    }
    return ConnectionCache.open(database.target(USER), new Credentials(USER, PASSWORD));
  }

  /**
   * SQL Server logs that it is ready before it has finished setting the sa password, so the first
   * logins can be rejected for a few seconds.
   */
  private static Connection connectWithRetry(String url, Properties props) throws SQLException {
    long giveUp = System.currentTimeMillis() + 60_000;
    while (true) {
      try {
        return DriverManager.getConnection(url, props);
      } catch (SQLException e) {
        if (System.currentTimeMillis() > giveUp) {
          throw e;
        }
        try {
          Thread.sleep(1_000);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw e;
        }
      }
    }
  }

  @ParameterizedTest
  @MethodSource("databases")
  void everyBuiltInQueryReturnsItsColumns(Database database) throws SQLException {
    QueryRunner runner = new QueryRunner(100);
    try (Connection connection = connect(database)) {
      for (QueryDefinition query : QueryLoader.builtIn(database.engine())) {
        List<QueryRunner.Row> rows = runner.run(connection, query, 10).rows();
        if (query.dimensions().isEmpty()) {
          assertEquals(1, rows.size(), query.name());
          assertEquals(
              query.metrics().size(), rows.getFirst().values().size(), query.name() + " has NULLs");
        }
        for (QueryRunner.Row row : rows) {
          assertFalse(row.values().isEmpty(), query.name());
        }
      }
    }
  }

  @ParameterizedTest
  @MethodSource("databases")
  void connectsToTheDefaultDatabase(Database database) throws SQLException {
    // The default, ORCL, is the RDS DB name; the Oracle Free image only has FREE and FREEPDB1.
    Assumptions.assumeFalse(database.engine() == Engine.ORACLE);
    try (Connection ignored = connect(database)) {
      Target byDefault =
          new Target(
              database.name(),
              database.engine(),
              database.container().getHost(),
              database.container().getMappedPort(database.engine().defaultPort()),
              database.engine().defaultDatabase(),
              USER,
              null,
              database.tls());
      try (Connection connection =
          ConnectionCache.open(byDefault, new Credentials(USER, PASSWORD))) {
        assertTrue(connection.isValid(2));
      }
    }
  }

  @ParameterizedTest
  @MethodSource("databases")
  void schemaSizeCoversSchemasWithoutTableGrants(Database database) throws SQLException {
    Assumptions.assumeTrue(database.engine() == Engine.MYSQL);
    QueryDefinition schemaSize =
        QueryLoader.builtIn(Engine.MYSQL).stream()
            .filter(query -> query.name().equals("schema_size"))
            .findFirst()
            .orElseThrow();
    try (Connection connection = connect(database)) {
      List<String> schemas =
          new QueryRunner(100)
              .run(connection, schemaSize, 10).rows().stream()
                  .map(row -> row.dimensions().get("SchemaName"))
                  .toList();
      assertTrue(schemas.contains("app"), schemas.toString());
    }
  }

  @ParameterizedTest
  @MethodSource("databases")
  void sessionsReportsEveryStateIncludingEmptyOnes(Database database) throws SQLException {
    QueryDefinition sessions =
        QueryLoader.builtIn(database.engine()).stream()
            .filter(query -> query.name().equals("sessions"))
            .findFirst()
            .orElseThrow();
    try (Connection connection = connect(database)) {
      List<QueryRunner.Row> rows = new QueryRunner(100).run(connection, sessions, 10).rows();
      assertEquals(SESSION_STATES.get(database.engine()), rows.size(), rows.toString());
      // Nothing else is connected, so at least one state has no sessions.
      assertTrue(rows.stream().anyMatch(row -> row.values().get("Sessions") == 0.0));
    }
  }

  @ParameterizedTest
  @MethodSource("databases")
  void databaseSizeCoversEveryDatabase(Database database) throws SQLException {
    Assumptions.assumeTrue(database.engine() == Engine.SQLSERVER);
    QueryDefinition size =
        QueryLoader.builtIn(Engine.SQLSERVER).stream()
            .filter(query -> query.name().equals("database_size"))
            .findFirst()
            .orElseThrow();
    try (Connection connection = connect(database)) {
      List<String> names =
          new QueryRunner(100)
              .run(connection, size, 10).rows().stream()
                  .map(row -> row.dimensions().get("DatabaseName"))
                  .toList();
      assertTrue(names.contains("app"), names.toString());
    }
  }

  @ParameterizedTest
  @MethodSource("databases")
  void sessionIsReadOnly(Database database) throws SQLException {
    // Oracle and SQL Server have no read-only session; their monitoring user is only granted
    // read access instead.
    Assumptions.assumeFalse(database.engine().sessionSetup().isEmpty());
    try (Connection connection = connect(database);
        Statement statement = connection.createStatement()) {
      SQLException e =
          assertThrows(
              SQLException.class, () -> statement.execute("INSERT INTO writable VALUES (1)"));
      assertTrue(e.getMessage().toLowerCase().contains("read"), e.getMessage());
    }
  }
}
