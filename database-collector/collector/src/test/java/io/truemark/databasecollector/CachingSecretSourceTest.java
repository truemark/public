package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class CachingSecretSourceTest {
  private Instant now = Instant.parse("2026-01-01T00:00:00Z");
  private final Clock clock =
      new Clock() {
        @Override
        public Instant instant() {
          return now;
        }

        @Override
        public java.time.ZoneId getZone() {
          return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
          return this;
        }
      };
  private final List<String> fetched = new ArrayList<>();
  private final CachingSecretSource cache =
      new CachingSecretSource(
          id -> {
            fetched.add(id);
            return "value-" + id;
          },
          Duration.ofMinutes(5),
          2,
          clock);

  @Test
  void fetchesOnceWithinTheTtlAndAgainAfterIt() {
    cache.get("a");
    cache.get("a");
    now = now.plus(Duration.ofMinutes(6));
    cache.get("a");

    assertEquals(List.of("a", "a"), fetched);
  }

  @Test
  void dropsExpiredSecretsEvenWhenAnotherIsAskedFor() {
    cache.get("a");
    now = now.plus(Duration.ofMinutes(6));
    cache.get("b");

    assertEquals(1, cache.size());
  }

  @Test
  void neverHoldsMoreThanItsLimit() {
    cache.get("a");
    now = now.plusSeconds(1);
    cache.get("b");
    now = now.plusSeconds(1);
    cache.get("c");

    assertEquals(2, cache.size());
    cache.get("b");
    cache.get("c");
    assertEquals(List.of("a", "b", "c"), fetched);
  }
}
