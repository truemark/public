package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class QuerySetsTest {
  private static final String SET =
      """
      - name: q
        interval: 15m
        sql: SELECT 1 AS n
        metrics: [{column: n, name: N}]
      """;

  /** A clock whose time the test moves forward. */
  private static final class MutableClock extends Clock {
    private Instant now = Instant.EPOCH;

    @Override
    public Instant instant() {
      return now;
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }
  }

  private final MutableClock clock = new MutableClock();
  private final AtomicInteger fetches = new AtomicInteger();

  private QuerySets sets(QuerySets.Fetcher ssm) {
    return new QuerySets(
        Map.of(QuerySets.Source.SSM, ssm), Duration.ofMinutes(5), Duration.ofMinutes(1), 10, clock);
  }

  @Test
  void parsesReferences() {
    assertEquals(new QuerySets.Ref(QuerySets.Source.SSM, "orders"), QuerySets.Ref.parse("orders"));
    assertEquals(
        new QuerySets.Ref(QuerySets.Source.S3, "orders"), QuerySets.Ref.parse(" s3:orders "));
    assertEquals("s3:orders", QuerySets.Ref.parse("S3:orders").toString());
    assertEquals(
        new QuerySets.Ref(QuerySets.Source.SSM, "team/orders.v2"),
        QuerySets.Ref.parse("SSM:team/orders.v2"));
    assertEquals("ssm:orders", QuerySets.Ref.parse("ssm:orders").toString());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"", "ftp:orders", "s3:", "../orders", "a//b", "/orders", "orders/", "a b"})
  void rejectsInvalidReferences(String text) {
    assertThrows(IllegalArgumentException.class, () -> QuerySets.Ref.parse(text));
  }

  @Test
  void splitsOnSpacesAndCommasAndDropsDuplicates() {
    assertEquals(List.of("a", "ssm:b", "c"), QuerySets.split(" a ssm:b,c  a "));
    assertEquals(List.of("a", "b", "c"), QuerySets.split(List.of("a", "b c")));
    assertEquals(List.of(), QuerySets.split(null));
    assertEquals(List.of(), QuerySets.split(" "));
  }

  @Test
  void qualifiesQueryNamesAndParsesIntervals() {
    QueryDefinition query = sets(name -> SET).get(QuerySets.Ref.parse("orders")).getFirst();

    assertEquals("orders/q", query.name());
    assertEquals(15, query.interval());
  }

  @Test
  void cachesUntilTheTtlExpires() {
    QuerySets sets =
        sets(name -> {
          fetches.incrementAndGet();
          return SET;
        });
    QuerySets.Ref ref = QuerySets.Ref.parse("orders");

    sets.get(ref);
    clock.advance(Duration.ofMinutes(4));
    sets.get(ref);
    assertEquals(1, fetches.get());

    clock.advance(Duration.ofMinutes(1));
    sets.get(ref);
    assertEquals(2, fetches.get());
  }

  @Test
  void remembersFailuresForAShorterTime() {
    QuerySets sets =
        sets(name -> {
          fetches.incrementAndGet();
          throw new IllegalStateException("Access denied");
        });
    QuerySets.Ref ref = QuerySets.Ref.parse("orders");

    RuntimeException error = assertThrows(RuntimeException.class, () -> sets.get(ref));
    assertTrue(error.getMessage().contains("ssm:orders"));
    assertTrue(error.getMessage().contains("Access denied"));
    assertThrows(RuntimeException.class, () -> sets.get(ref));
    assertEquals(1, fetches.get());

    clock.advance(Duration.ofMinutes(1));
    assertThrows(RuntimeException.class, () -> sets.get(ref));
    assertEquals(2, fetches.get());
  }

  @Test
  void failsForSourceWithoutFetcher() {
    RuntimeException error =
        assertThrows(
            RuntimeException.class, () -> sets(name -> SET).get(QuerySets.Ref.parse("s3:x")));
    assertTrue(error.getMessage().contains("No s3 query set source"));
  }

  @Test
  void rejectsInvalidEmptyAndOversizedSets() {
    QuerySets.Ref ref = QuerySets.Ref.parse("orders");
    assertThrows(RuntimeException.class, () -> sets(name -> "- {name: q}").get(ref));
    assertThrows(RuntimeException.class, () -> sets(name -> " ").get(ref));
    assertThrows(
        RuntimeException.class,
        () -> sets(name -> SET + "#".repeat(QuerySets.MAX_LENGTH)).get(ref));
  }

  @Test
  void holdsAtMostMaxEntries() {
    QuerySets sets =
        new QuerySets(
            Map.of(
                QuerySets.Source.SSM,
                name -> {
                  fetches.incrementAndGet();
                  return SET;
                }),
            Duration.ofMinutes(5),
            Duration.ofMinutes(1),
            1,
            clock);

    sets.get(QuerySets.Ref.parse("a"));
    sets.get(QuerySets.Ref.parse("b"));
    sets.get(QuerySets.Ref.parse("a"));

    assertEquals(3, fetches.get());
  }
}
