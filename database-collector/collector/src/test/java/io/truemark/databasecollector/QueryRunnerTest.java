package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Map;
import org.junit.jupiter.api.Test;

class QueryRunnerTest {
  private static final QueryDefinition QUERY =
      QueryLoader.parse(
              """
              - name: q
                sql: |
                  SELECT * FROM (VALUES ('a', 1), (CAST(NULL AS VARCHAR), 2)) AS t("Name", n)
                dimensions: [Name]
                metrics:
                  - {column: n, name: N}
              """)
          .getFirst();

  private static Connection h2() throws Exception {
    return DriverManager.getConnection("jdbc:h2:mem:");
  }

  @Test
  void reportsNullDimensionAsNonEmptyValue() throws Exception {
    try (Connection connection = h2()) {
      QueryRunner.Result result = new QueryRunner(100).run(connection, QUERY, 5);

      assertEquals(Map.of("Name", "null"), result.rows().get(1).dimensions());
      assertFalse(result.truncated());
    }
  }

  @Test
  void doesNotReportTruncationWhenResultFillsTheLimitExactly() throws Exception {
    try (Connection connection = h2()) {
      QueryRunner.Result result = new QueryRunner(2).run(connection, QUERY, 5);

      assertEquals(2, result.rows().size());
      assertFalse(result.truncated());
    }
  }

  @Test
  void reportsTruncationAtTheRowLimit() throws Exception {
    try (Connection connection = h2()) {
      QueryRunner.Result result = new QueryRunner(1).run(connection, QUERY, 5);

      assertEquals(1, result.rows().size());
      assertTrue(result.truncated());
    }
  }
}
