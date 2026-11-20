package io.truemark.databasecollector;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Custom query sets: YAML files in the same format as the built-in queries, kept in S3 or SSM
 * Parameter Store and named by a target's {@code querySets} field.
 *
 * <p>A reference is a set name, optionally prefixed with its source: {@code orders} and {@code
 * ssm:orders} read the parameter {@code orders} under the query set parameter path, {@code
 * s3:orders} reads {@code query-sets/orders.yaml} from the query set bucket. Names may contain
 * letters, digits, {@code _}, {@code -}, and {@code .} or {@code /} between those.
 *
 * <p>Sets are cached so that a database collected every minute does not fetch them every minute. A
 * set that could not be loaded is remembered for a shorter time, so a fix is picked up quickly
 * without every collection paying for a failing fetch.
 */
public class QuerySets {
  /** Where a query set is kept. */
  public enum Source {
    S3,
    SSM;

    String prefix() {
      return name().toLowerCase(Locale.ROOT);
    }
  }

  /** Names one query set. */
  public record Ref(Source source, String name) {
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*");

    /** Parses a reference such as {@code orders}, {@code s3:orders} or {@code ssm:team/orders}. */
    public static Ref parse(String text) {
      String value = text.trim();
      Source source = Source.SSM;
      int colon = value.indexOf(':');
      if (colon >= 0) {
        String prefix = value.substring(0, colon).toLowerCase(Locale.ROOT);
        source =
            switch (prefix) {
              case "s3" -> Source.S3;
              case "ssm" -> Source.SSM;
              default -> throw new IllegalArgumentException("Unknown query set source: " + text);
            };
        value = value.substring(colon + 1);
      }
      if (!NAME.matcher(value).matches()) {
        throw new IllegalArgumentException("Invalid query set name: " + text);
      }
      return new Ref(source, value);
    }

    @Override
    public String toString() {
      return source.prefix() + ":" + name;
    }
  }

  /** Reads the YAML text of a query set from one source. */
  @FunctionalInterface
  public interface Fetcher {
    String fetch(String name);
  }

  /** Largest query set accepted, in characters. */
  static final int MAX_LENGTH = 64 * 1024;

  /** Most query sets one target may name. */
  static final int MAX_PER_TARGET = 10;

  private record Entry(List<QueryDefinition> queries, RuntimeException error, Instant expires) {}

  private final Map<Source, Fetcher> fetchers;
  private final Duration ttl;
  private final Duration failureTtl;
  private final int maxEntries;
  private final Clock clock;
  private final Map<Ref, Entry> entries = new ConcurrentHashMap<>();

  /**
   * @param fetchers one per configured source; a reference to a source without one fails
   * @param ttl how long a loaded set is used before it is fetched again
   * @param failureTtl how long a set that could not be loaded is reported as failed without trying
   *     again
   * @param maxEntries most sets held at once; the one that expires first makes room for a new one
   */
  public QuerySets(
      Map<Source, Fetcher> fetchers,
      Duration ttl,
      Duration failureTtl,
      int maxEntries,
      Clock clock) {
    this.fetchers = fetchers.isEmpty() ? Map.of() : new EnumMap<>(fetchers);
    this.ttl = ttl;
    this.failureTtl = failureTtl;
    this.maxEntries = maxEntries;
    this.clock = clock;
  }

  /** Query sets with no source configured: every reference fails. */
  public static QuerySets none(Clock clock) {
    return new QuerySets(Map.of(), Duration.ZERO, Duration.ZERO, 0, clock);
  }

  /**
   * Splits a target's {@code querySets} field into references, dropping duplicates. The field is
   * either text with names separated by spaces or commas (tag values cannot contain commas, so tags
   * use spaces) or a list of names. Each name is parsed later with {@link Ref#parse}, so that one
   * invalid name only affects its own set.
   */
  public static List<String> split(Object value) {
    if (value == null) {
      return List.of();
    }
    Set<String> names = new LinkedHashSet<>();
    Collection<?> items = value instanceof Collection<?> list ? list : List.of(value);
    for (Object item : items) {
      if (item == null) {
        continue;
      }
      for (String name : item.toString().split("[\\s,]+")) {
        if (!name.isEmpty()) {
          names.add(name);
        }
      }
    }
    return List.copyOf(names);
  }

  /**
   * Returns the queries of a set, each named {@code <set>/<query>} so that logs tell it apart from
   * a built-in query of the same name.
   *
   * @throws RuntimeException when the set cannot be fetched or is not valid
   */
  public List<QueryDefinition> get(Ref ref) {
    Instant now = clock.instant();
    entries.values().removeIf(entry -> !entry.expires().isAfter(now));
    Entry entry = entries.get(ref);
    if (entry == null) {
      entry = load(ref, now);
      if (maxEntries > 0) {
        if (entries.size() >= maxEntries) {
          entries.entrySet().stream()
              .min(Map.Entry.comparingByValue((a, b) -> a.expires().compareTo(b.expires())))
              .map(Map.Entry::getKey)
              .ifPresent(entries::remove);
        }
        entries.put(ref, entry);
      }
    }
    if (entry.error() != null) {
      throw entry.error();
    }
    return entry.queries();
  }

  private Entry load(Ref ref, Instant now) {
    try {
      Fetcher fetcher = fetchers.get(ref.source());
      if (fetcher == null) {
        throw new IllegalStateException("No " + ref.source().prefix() + " query set source");
      }
      String yaml = fetcher.fetch(ref.name());
      if (yaml == null || yaml.isBlank()) {
        throw new IllegalArgumentException("Query set is empty");
      }
      if (yaml.length() > MAX_LENGTH) {
        throw new IllegalArgumentException(
            "Query set is larger than " + MAX_LENGTH + " characters");
      }
      List<QueryDefinition> queries = new ArrayList<>();
      for (QueryDefinition query : QueryLoader.parse(yaml)) {
        queries.add(query.withName(ref.name() + "/" + query.name()));
      }
      return new Entry(List.copyOf(queries), null, now.plus(ttl));
    } catch (RuntimeException e) {
      String detail = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
      return new Entry(
          null,
          new IllegalStateException("Query set " + ref + " could not be loaded: " + detail, e),
          now.plus(failureTtl));
    }
  }

  /** Forgets every set, so a SnapStart snapshot does not restore stale ones. */
  public void clear() {
    entries.clear();
  }
}
