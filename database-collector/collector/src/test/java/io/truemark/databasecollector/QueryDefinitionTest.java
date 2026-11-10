package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.UncheckedIOException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class QueryDefinitionTest {

  @ParameterizedTest
  @EnumSource(Engine.class)
  void builtInQueriesAreValid(Engine engine) {
    assertFalse(QueryLoader.builtIn(engine).isEmpty());
  }

  @Test
  void appliesDefaults() {
    List<QueryDefinition> queries =
        QueryLoader.parse(
            """
            - name: q
              sql: SELECT 1 AS n
              metrics:
                - {column: n, name: N}
            """);

    QueryDefinition query = queries.getFirst();
    assertEquals(1, query.interval());
    assertEquals(List.of(), query.dimensions());
    assertEquals("None", query.metrics().getFirst().unit());
  }

  @Test
  void runsOnlyOnItsInterval() {
    QueryDefinition query =
        new QueryDefinition(
            "q", "SELECT 1", 15, null, List.of(new QueryDefinition.Metric("n", "N", null)));

    assertTrue(query.isDue(30));
    assertFalse(query.isDue(31));
  }

  @Test
  void rejectsQueryWithoutMetrics() {
    assertThrows(UncheckedIOException.class, () -> QueryLoader.parse("- {name: q, sql: SELECT 1}"));
  }

  @Test
  void rejectsNameUsedByTheCollector() {
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new QueryDefinition(
                "q",
                "SELECT 1",
                1,
                List.of("Target"),
                List.of(new QueryDefinition.Metric("n", "N", null))));
  }
}
