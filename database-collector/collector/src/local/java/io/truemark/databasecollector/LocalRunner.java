package io.truemark.databasecollector;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Runs the collector on a workstation, without Lambda or AWS, against the databases listed in a
 * YAML file. Metric and log lines go to stdout exactly as the function writes them; a one-line
 * summary per collection goes to stderr.
 *
 * <p>Not part of the Lambda package: it lives in the {@code local} source set.
 *
 * <pre>
 * targets:            # each one is the event the function would be invoked with
 *   - {id: pg, engine: postgres, host: localhost, port: 5432, secretId: pg, tls: off}
 * secrets:            # what Secrets Manager would return for each secretId
 *   pg: {username: database_collector, password: secret}
 * querySets:          # what S3 or SSM would return for each query set reference
 *   orders: [...]     # same as ssm:orders; use "s3:orders" for a set kept in S3
 * </pre>
 *
 * <p>{@code ${NAME}} and {@code ${NAME:-default}} in the file are replaced with environment
 * variables. IAM authentication is not available locally, so every target needs a secret.
 *
 * <p>Usage: {@code LocalRunner <config.yaml> [--once]}. The first collection runs every query
 * whatever its interval, custom query sets included, so all metrics show up straight away. Without
 * {@code --once} it then collects at the start of every minute, honouring intervals, as the
 * deployed schedule does.
 */
public final class LocalRunner {
  private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Pattern VARIABLE = Pattern.compile("\\$\\{(\\w+)(?::-([^}]*))?}");
  private static final long DEADLINE_MILLIS = 50_000;

  private LocalRunner() {}

  public static void main(String[] args) throws Exception {
    if (args.length < 1) {
      System.err.println("Usage: LocalRunner <config.yaml> [--once]");
      System.exit(2);
    }
    boolean once = List.of(args).contains("--once");
    Map<String, Object> config = readConfig(Path.of(args[0]));

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> targets =
        (List<Map<String, Object>>) config.getOrDefault("targets", List.of());
    @SuppressWarnings("unchecked")
    Map<String, Object> secretValues =
        (Map<String, Object>) config.getOrDefault("secrets", Map.of());
    @SuppressWarnings("unchecked")
    Map<String, Object> querySetValues =
        (Map<String, Object>) config.getOrDefault("querySets", Map.of());
    if (targets.isEmpty()) {
      throw new IllegalArgumentException("No targets in " + args[0]);
    }

    Map<String, String> secrets = new LinkedHashMap<>();
    for (Map.Entry<String, Object> entry : secretValues.entrySet()) {
      secrets.put(entry.getKey(), JSON.writeValueAsString(entry.getValue()));
    }
    SecretSource secretSource =
        id -> {
          String value = secrets.get(id);
          if (value == null) {
            throw new IllegalStateException("No secret " + id + " in the local config");
          }
          return value;
        };
    TokenSource noIam =
        (host, port, username) -> {
          throw new IllegalStateException(
              "IAM authentication is not available locally; give the target a secretId");
        };

    Map<Engine, List<QueryDefinition>> builtIn = new EnumMap<>(Engine.class);
    Map<Engine, List<QueryDefinition>> everyMinute = new EnumMap<>(Engine.class);
    for (Engine engine : Engine.values()) {
      List<QueryDefinition> queries = QueryLoader.builtIn(engine);
      builtIn.put(engine, queries);
      everyMinute.put(
          engine,
          queries.stream()
              .map(q -> new QueryDefinition(q.name(), q.sql(), 1, q.dimensions(), q.metrics()))
              .toList());
    }

    Clock clock = Clock.systemUTC();
    String namespace = System.getenv().getOrDefault("METRICS_NAMESPACE", "DatabaseCollector");
    // Shared by both collectors so later collections reuse connections, as a warm function does.
    ConnectionCache connections =
        new ConnectionCache(ConnectionCache::open, Duration.ofMinutes(5), 20, clock);
    TargetResolver resolver = new TargetResolver(secretSource, noIam);
    QuerySets everyMinuteSets = localQuerySets(querySetValues, true, clock);
    QuerySets scheduledSets = localQuerySets(querySetValues, false, clock);
    BiFunction<Function<Engine, List<QueryDefinition>>, QuerySets, Collector> collectorFor =
        (queries, querySets) ->
            new Collector(
                resolver,
                connections,
                new QueryRunner(100),
                10,
                queries,
                querySets,
                new Emf(namespace, System.out::println),
                new Log(System.out::println),
                clock,
                id -> {});

    collectAll(collectorFor.apply(everyMinute::get, everyMinuteSets), targets, clock);
    if (once) {
      connections.closeAll();
      return;
    }
    Collector scheduled = collectorFor.apply(builtIn::get, scheduledSets);
    while (true) {
      long now = clock.millis();
      Thread.sleep(60_000 - now % 60_000);
      collectAll(scheduled, targets, clock);
    }
  }

  private static void collectAll(
      Collector collector, List<Map<String, Object>> targets, Clock clock) {
    for (Map<String, Object> event : targets) {
      try {
        Collector.Result result = collector.collect(event, clock.millis() + DEADLINE_MILLIS);
        System.err.printf(
            "%s up=%s queries=%d errors=%d%n",
            result.id(), result.up(), result.queries(), result.errors());
      } catch (RuntimeException e) {
        // The function would fail this invocation; locally, report it and carry on.
        System.err.printf("%s invalid: %s%n", event.get("id"), e.getMessage());
      }
    }
  }

  /**
   * Serves the {@code querySets} section of the config as if it came from S3 or SSM.
   *
   * @param everyMinute whether to drop each query's interval, for the first collection
   */
  private static QuerySets localQuerySets(
      Map<String, Object> values, boolean everyMinute, Clock clock) throws IOException {
    Map<String, String> yaml = new LinkedHashMap<>();
    for (Map.Entry<String, Object> entry : values.entrySet()) {
      Object queries = entry.getValue();
      if (everyMinute && queries instanceof List<?> list) {
        queries =
            list.stream()
                .map(q -> {
                  if (!(q instanceof Map<?, ?> map)) {
                    return q;
                  }
                  Map<Object, Object> copy = new LinkedHashMap<>(map);
                  copy.remove("interval");
                  return copy;
                })
                .toList();
      }
      yaml.put(QuerySets.Ref.parse(entry.getKey()).toString(), YAML.writeValueAsString(queries));
    }
    Map<QuerySets.Source, QuerySets.Fetcher> fetchers = new EnumMap<>(QuerySets.Source.class);
    for (QuerySets.Source source : QuerySets.Source.values()) {
      fetchers.put(
          source,
          name -> {
            String text = yaml.get(new QuerySets.Ref(source, name).toString());
            if (text == null) {
              throw new IllegalStateException("No query set " + name + " in the local config");
            }
            return text;
          });
    }
    // The config is only read at start, so there is nothing newer to fetch later.
    return new QuerySets(fetchers, Duration.ofDays(1), Duration.ofDays(1), 100, clock);
  }

  private static Map<String, Object> readConfig(Path path) throws IOException {
    Matcher matcher = VARIABLE.matcher(Files.readString(path));
    StringBuilder text = new StringBuilder();
    while (matcher.find()) {
      String value = System.getenv(matcher.group(1));
      if (value == null) {
        value = matcher.group(2) == null ? "" : matcher.group(2);
      }
      matcher.appendReplacement(text, Matcher.quoteReplacement(value));
    }
    matcher.appendTail(text);
    @SuppressWarnings("unchecked")
    Map<String, Object> config = YAML.readValue(text.toString(), Map.class);
    return config;
  }
}
