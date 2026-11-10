package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Properties;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
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
  private static final String MIRROR = "public.ecr.aws/docker/library/";
  private static final String USER = "database_collector";
  private static final String PASSWORD = "collector-test";

  private static final String ADMIN_PASSWORD = "admin-test";

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
    return new GenericContainer<>(DockerImageName.parse(MIRROR + image))
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
              mysqlSetup()));

  private static List<String> mysqlSetup() {
    return List.of(
        "CREATE USER '" + USER + "'@'%' IDENTIFIED BY '" + PASSWORD + "'",
        "GRANT PROCESS ON *.* TO '" + USER + "'@'%'",
        "CREATE TABLE test.writable (id int)",
        "GRANT ALL ON test.writable TO '" + USER + "'@'%'");
  }

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
      try (Connection connection = DriverManager.getConnection(admin.jdbcUrl(), props);
          Statement statement = connection.createStatement()) {
        for (String sql : database.setup()) {
          statement.execute(sql);
        }
      }
    }
    return ConnectionCache.open(database.target(USER), new Credentials(USER, PASSWORD));
  }

  @ParameterizedTest
  @MethodSource("databases")
  void everyBuiltInQueryReturnsItsColumns(Database database) throws SQLException {
    QueryRunner runner = new QueryRunner(10, 100);
    try (Connection connection = connect(database)) {
      for (QueryDefinition query : QueryLoader.builtIn(database.engine())) {
        List<QueryRunner.Row> rows = runner.run(connection, query);
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
  void sessionIsReadOnly(Database database) throws SQLException {
    try (Connection connection = connect(database);
        Statement statement = connection.createStatement()) {
      SQLException e =
          assertThrows(
              SQLException.class, () -> statement.execute("INSERT INTO writable VALUES (1)"));
      assertTrue(e.getMessage().toLowerCase().contains("read"), e.getMessage());
    }
  }
}
