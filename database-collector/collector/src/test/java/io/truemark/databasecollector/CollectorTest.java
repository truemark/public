package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.DriverManager;
import java.sql.SQLException;
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

  private Collector collector(String namespace, ConnectionCache.Opener opener, String queries) {
    Clock clock = CLOCK;
    return new Collector(
        new TargetResolver(id -> "{\"password\":\"p\"}", (host, port, username) -> "token"),
        new ConnectionCache(opener, Duration.ofMinutes(5), 2, clock),
        new QueryRunner(100),
        5,
        engine -> QueryLoader.parse(queries),
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
    assertEquals(List.of("s1"), loginFailures);
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

    // The connection is not trusted after a failed query.
    collector.collect(EVENT, DEADLINE);
    assertEquals(2, opened);
  }
}
