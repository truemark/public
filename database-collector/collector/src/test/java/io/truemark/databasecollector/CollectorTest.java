package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Runs the collector against an in-memory H2 database standing in for a real engine. */
class CollectorTest {
  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final Map<String, Object> EVENT =
      Map.of("id", "db1", "engine", "postgres", "host", "localhost", "username", "sa");

  private final List<String> lines = new ArrayList<>();
  private final List<String> loginFailures = new ArrayList<>();
  private int opened;

  // An epoch minute divisible by every interval used below.
  private static final Clock CLOCK =
      Clock.fixed(Instant.ofEpochSecond(60 * 60 * 24), ZoneOffset.UTC);
  private static final long DEADLINE = CLOCK.millis() + 50_000;

  private SecretSource secrets = id -> "{\"password\":\"p\"}";
  private QuerySets querySets = QuerySets.none(CLOCK);

  private Collector collector(String namespace, ConnectionCache.Opener opener, String queries) {
    return collector(namespace, opener, queries, CLOCK, new QueryRunner(100));
  }

  private Collector collector(
      ConnectionCache.Opener opener, String queries, Clock clock, QueryRunner runner) {
    return collector("Test", opener, queries, clock, runner);
  }

  private Collector collector(
      String namespace,
      ConnectionCache.Opener opener,
      String queries,
      Clock clock,
      QueryRunner runner) {
    return new Collector(
        new TargetResolver(id -> secrets.get(id), (host, port, username) -> "token"),
        new ConnectionCache(opener, Duration.ofMinutes(5), 2, clock),
        runner,
        5,
        engine -> QueryLoader.parse(queries),
        querySets,
        new Emf(namespace, lines::add),
        new Log(lines::add),
        clock,
        loginFailures::add);
  }

  private ConnectionCache.Opener h2() {
    return (target, credentials) -> {
      opened++;
      return DriverManager.getConnection("jdbc:h2:mem:" + target.id() + ";DB_CLOSE_DELAY=-1");
    };
  }

  private List<JsonNode> json() throws Exception {
    List<JsonNode> nodes = new ArrayList<>();
    for (String line : lines) {
      nodes.add(MAPPER.readTree(line));
    }
    return nodes;
  }

  private static final String QUERIES =
      """
      - name: by_state
        sql: |
          SELECT * FROM (VALUES ('active', 3, 1.5), ('idle', 7, CAST(NULL AS DOUBLE))) AS t("State", n, secs)
        dimensions: [State]
        metrics:
          - {column: n, name: Sessions, unit: Count}
          - {column: secs, name: Age, unit: Seconds}
      - name: skipped
        interval: 7
        sql: SELECT 1 AS n
        metrics:
          - {column: n, name: Skipped}
      """;

  @Test
  void writesOneEmbeddedMetricLinePerRow() throws Exception {
    Collector.Result result = collector("Test", h2(), QUERIES).collect(EVENT, DEADLINE);

    assertEquals(new Collector.Result("db1", true, 1, 0), result);
    List<JsonNode> out = json();
    assertEquals(3, out.size());

    JsonNode active = out.get(0);
    assertEquals("db1", active.get("Target").asText());
    assertEquals("postgresql", active.get("Engine").asText());
    assertEquals("by_state", active.get("Query").asText());
    assertEquals("active", active.get("State").asText());
    assertEquals(3, active.get("Sessions").asInt());
    assertEquals(1.5, active.get("Age").asDouble());
    JsonNode directive = active.get("_aws").get("CloudWatchMetrics").get(0);
    assertEquals("Test", directive.get("Namespace").asText());
    assertEquals("[[\"Target\",\"State\"]]", directive.get("Dimensions").toString());
    assertEquals(2, directive.get("Metrics").size());

    // A NULL column is neither written nor declared as a metric.
    JsonNode idle = out.get(1);
    assertFalse(idle.has("Age"));
    assertEquals(1, idle.get("_aws").get("CloudWatchMetrics").get(0).get("Metrics").size());

    JsonNode self = out.get(2);
    assertEquals("collector", self.get("Query").asText());
    assertEquals(1, self.get("Up").asInt());
    assertEquals(0, self.get("QueryErrors").asInt());
    assertTrue(self.has("ConnectMillis"));
  }

  @Test
  void writesPlainJsonWithoutNamespace() throws Exception {
    collector("", h2(), QUERIES).collect(EVENT, DEADLINE);

    for (JsonNode line : json()) {
      assertFalse(line.has("_aws"));
      assertTrue(line.has("timestamp"));
    }
  }

  @Test
  void reusesTheConnectionBetweenCollections() {
    Collector collector = collector("Test", h2(), QUERIES);

    collector.collect(EVENT, DEADLINE);
    collector.collect(EVENT, DEADLINE);

    assertEquals(1, opened);
  }

  /** A runner whose queries all fail with the given exception. */
  private static QueryRunner failingWith(SQLException e) {
    return new QueryRunner(100) {
      @Override
      public Result run(Connection connection, QueryDefinition query, int timeoutSeconds)
          throws SQLException {
        throw e;
      }
    };
  }

  private static final Map<String, Object> SECRET_EVENT =
      Map.of("id", "db1", "engine", "mysql", "host", "h", "secretId", "s1", "username", "u");

  private static ConnectionCache.Opener failingOpener(Exception e) {
    return (target, credentials) -> {
      if (e instanceof SQLException sql) {
        throw sql;
      }
      throw (RuntimeException) e;
    };
  }

  @Test
  void reportsDownWhenConnectionFails() throws Exception {
    ConnectionCache.Opener failing =
        (target, credentials) -> {
          throw new SQLException("Connection refused");
        };
    Map<String, Object> event =
        Map.of("id", "db1", "engine", "mysql", "host", "h", "secretId", "s1", "username", "u");

    Collector.Result result = collector("Test", failing, QUERIES).collect(event, DEADLINE);

    assertEquals(new Collector.Result("db1", false, 0, 0), result);
    List<JsonNode> out = json();
    assertEquals("ERROR", out.get(0).get("level").asText());
    assertEquals("Connection refused", out.get(0).get("error").asText());
    assertEquals(0, out.get(1).get("Up").asInt());
    // A database that is down says nothing about the secret, so it stays cached.
    assertEquals(List.of(), loginFailures);
  }

  @Test
  void invalidatesSecretWhenLoginIsRejected() {
    SQLException denied = new SQLException("Access denied for user 'u'", "28000", 1045);

    collector("Test", failingOpener(denied), QUERIES).collect(SECRET_EVENT, DEADLINE);

    assertEquals(List.of("s1"), loginFailures);
  }

  @Test
  void findsLoginRejectionInTheCauseChain() {
    SQLException rejected = new SQLException("password authentication failed", "28P01");

    collector("Test", failingOpener(new IllegalStateException("wrapped", rejected)), QUERIES)
        .collect(SECRET_EVENT, DEADLINE);

    assertEquals(List.of("s1"), loginFailures);
  }

  @Test
  void keepsSecretWhenConnectionIsRefused() {
    SQLException refused = new SQLException("Connection refused", "08001");

    collector("Test", failingOpener(refused), QUERIES).collect(SECRET_EVENT, DEADLINE);

    assertEquals(List.of(), loginFailures);
  }

  @Test
  void skipsQueriesWhenOutOfTimeButStillReports() throws Exception {
    Collector.Result result =
        collector("Test", h2(), QUERIES).collect(EVENT, CLOCK.millis() + 1_000);

    assertEquals(new Collector.Result("db1", true, 0, 1), result);
    List<JsonNode> out = json();
    assertEquals("Query skipped", out.get(0).get("message").asText());
    assertEquals(1, out.get(1).get("Up").asInt());
    assertEquals(1, out.get(1).get("QueryErrors").asInt());
  }

  @Test
  void reportsDownWhenSecretCannotBeRead() throws Exception {
    secrets =
        id -> {
          throw new IllegalStateException("Read timed out");
        };

    Collector.Result result =
        collector("Test", h2(), QUERIES).collect(Map.of("id", "db1", "secretId", "s1"), DEADLINE);

    assertEquals(new Collector.Result("db1", false, 0, 0), result);
    List<JsonNode> out = json();
    assertEquals("Secret unavailable", out.get(0).get("message").asText());
    assertEquals("ERROR", out.get(0).get("level").asText());
    assertEquals("db1", out.get(1).get("Target").asText());
    assertEquals(0, out.get(1).get("Up").asInt());
    assertFalse(out.get(1).has("Engine"));
  }

  @Test
  void countsFailedQueriesAndKeepsGoing() throws Exception {
    String queries =
        """
        - name: broken
          sql: SELECT * FROM missing_table
          metrics:
            - {column: n, name: Broken}
        - name: ok
          sql: SELECT 5 AS n
          metrics:
            - {column: n, name: Ok}
        """;
    Collector collector = collector("Test", h2(), queries);

    Collector.Result result = collector.collect(EVENT, DEADLINE);

    assertEquals(new Collector.Result("db1", true, 1, 1), result);
    List<JsonNode> out = json();
    assertEquals("broken", out.get(0).get("Query").asText());
    assertEquals("ERROR", out.get(0).get("level").asText());
    assertEquals(5, out.get(1).get("Ok").asInt());
    assertEquals(1, out.get(2).get("QueryErrors").asInt());

    // A query that fails on its own, here a missing table, does not cost a reconnect.
    collector.collect(EVENT, DEADLINE);
    assertEquals(1, opened);
  }

  @Test
  void discardsConnectionAfterConnectionException() {
    Collector collector =
        collector(h2(), QUERIES, CLOCK, failingWith(new SQLException("Connection reset", "08S01")));

    collector.collect(EVENT, DEADLINE);
    collector.collect(EVENT, DEADLINE);

    assertEquals(2, opened);
  }

  @Test
  void discardsConnectionAfterTimeout() {
    Collector collector =
        collector(h2(), QUERIES, CLOCK, failingWith(new SQLTimeoutException("Query timed out")));

    collector.collect(EVENT, DEADLINE);
    collector.collect(EVENT, DEADLINE);

    assertEquals(2, opened);
  }

  @Test
  void roundsToTheNearestMinute() {
    // Epoch minute 1442 is divisible by 7, so the "skipped" query is due in it and not after it.
    Clock due = Clock.offset(CLOCK, Duration.ofMinutes(2));
    Clock early = Clock.offset(due, Duration.ofSeconds(-1));
    Clock late = Clock.offset(due, Duration.ofSeconds(31));

    Collector.Result invokedEarly =
        collector(h2(), QUERIES, early, new QueryRunner(100))
            .collect(EVENT, early.millis() + 50_000);
    Collector.Result invokedLate =
        collector(h2(), QUERIES, late, new QueryRunner(100)).collect(EVENT, late.millis() + 50_000);

    assertEquals(2, invokedEarly.queries());
    assertEquals(1, invokedLate.queries());
  }

  @Test
  void runsCustomQuerySetsAlongsideBuiltInQueries() throws Exception {
    querySets =
        new QuerySets(
            Map.of(
                QuerySets.Source.SSM,
                name ->
                    """
                    - name: every_minute
                      sql: SELECT 7 AS n
                      metrics: [{column: n, name: Seven}]
                    - name: not_due
                      interval: 7m
                      sql: SELECT 8 AS n
                      metrics: [{column: n, name: Eight}]
                    """),
            Duration.ofMinutes(5),
            Duration.ofMinutes(1),
            10,
            CLOCK);
    Map<String, Object> event = new java.util.HashMap<>(EVENT);
    event.put("querySets", "orders");

    // Epoch minute 1440 is not divisible by 7, so only the first custom query is due.
    Collector.Result result = collector("Test", h2(), QUERIES).collect(event, DEADLINE);

    assertEquals(new Collector.Result("db1", true, 2, 0), result);
    JsonNode custom = json().stream().filter(line -> line.has("Seven")).findFirst().orElseThrow();
    assertEquals("orders/every_minute", custom.get("Query").asText());
    assertFalse(lines.stream().anyMatch(line -> line.contains("Eight")));
  }

  @Test
  void reportsUnavailableQuerySetAndKeepsGoing() throws Exception {
    Map<String, Object> event = new java.util.HashMap<>(EVENT);
    event.put("querySets", "ssm:missing bad:name");

    Collector.Result result = collector("Test", h2(), QUERIES).collect(event, DEADLINE);

    // Both sets fail; the built-in query still runs.
    assertEquals(new Collector.Result("db1", true, 1, 2), result);
    List<JsonNode> errors =
        json().stream().filter(line -> "ERROR".equals(line.path("level").asText())).toList();
    assertEquals(2, errors.size());
    assertEquals("ssm:missing", errors.get(0).get("Query").asText());
    assertEquals("Query set unavailable", errors.get(0).get("message").asText());
    assertEquals("bad:name", errors.get(1).get("Query").asText());
    assertEquals(2, json().getLast().get("QueryErrors").asInt());
  }

  @Test
  void skipsQuerySetsBeyondTheLimit() {
    Map<String, Object> event = new java.util.HashMap<>(EVENT);
    List<String> names = new ArrayList<>();
    for (int i = 0; i <= QuerySets.MAX_PER_TARGET; i++) {
      names.add("set" + i);
    }
    event.put("querySets", names);

    Collector.Result result = collector("Test", h2(), QUERIES).collect(event, DEADLINE);

    // No source is configured, so every set fails; the one beyond the limit is not even tried.
    assertEquals(QuerySets.MAX_PER_TARGET + 1, result.errors());
    assertTrue(lines.stream().anyMatch(line -> line.contains("Query set skipped")));
  }

  @Test
  void warnsWhenResultIsTruncated() throws Exception {
    collector(h2(), QUERIES, CLOCK, new QueryRunner(1)).collect(EVENT, DEADLINE);

    List<JsonNode> out = json();
    assertEquals("active", out.get(0).get("State").asText());
    JsonNode warning = out.get(1);
    assertEquals("WARN", warning.get("level").asText());
    assertEquals("Query result truncated", warning.get("message").asText());
    assertEquals("db1", warning.get("Target").asText());
    assertEquals("postgresql", warning.get("Engine").asText());
    assertEquals("by_state", warning.get("Query").asText());
    assertEquals(1, warning.get("limit").asInt());
  }
}
