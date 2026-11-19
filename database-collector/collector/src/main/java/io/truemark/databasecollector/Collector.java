package io.truemark.databasecollector;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;

/** Collects metrics from one database: connects, runs the queries that are due, writes results. */
public class Collector {
  /**
   * Outcome of one collection.
   *
   * @param up whether the collector could log in to the database
   * @param queries queries that ran successfully
   * @param errors queries that failed
   */
  public record Result(String id, boolean up, int queries, int errors) {}

  /** Query name the collector reports its own metrics under. */
  static final String SELF = "collector";

  private static final List<Emf.Unit> SELF_UNITS =
      List.of(
          new Emf.Unit("Up", "Count"),
          new Emf.Unit("ConnectMillis", "Milliseconds"),
          new Emf.Unit("CollectMillis", "Milliseconds"),
          new Emf.Unit("QueryErrors", "Count"));

  /** Time kept back from the deadline to write the collector's own metrics. */
  private static final long RESERVED_MILLIS = 2_000;

  private final TargetResolver resolver;
  private final ConnectionCache connections;
  private final QueryRunner runner;
  private final int queryTimeoutSeconds;
  private final Function<Engine, List<QueryDefinition>> queries;
  private final QuerySets querySets;
  private final Emf emf;
  private final Log log;
  private final Clock clock;
  private final Consumer<String> onLoginFailure;

  /**
   * @param queryTimeoutSeconds how long one query may run
   * @param queries supplies the built-in queries to run for an engine
   * @param querySets loads the custom query sets a target names
   * @param onLoginFailure told the secret ID when a login with that secret failed
   */
  public Collector(
      TargetResolver resolver,
      ConnectionCache connections,
      QueryRunner runner,
      int queryTimeoutSeconds,
      Function<Engine, List<QueryDefinition>> queries,
      QuerySets querySets,
      Emf emf,
      Log log,
      Clock clock,
      Consumer<String> onLoginFailure) {
    this.resolver = resolver;
    this.connections = connections;
    this.runner = runner;
    this.queryTimeoutSeconds = queryTimeoutSeconds;
    this.queries = queries;
    this.querySets = querySets;
    this.emf = emf;
    this.log = log;
    this.clock = clock;
    this.onLoginFailure = onLoginFailure;
  }

  /**
   * Collects from the database the event describes.
   *
   * <p>An unreachable database or a failing query is an expected condition: it is reported as a
   * metric and a log line, not thrown, and so is a secret that cannot be read. Only an event or
   * secret that does not describe a database throws.
   *
   * @param deadlineMillis time, on the collector's clock, by which the collection must be done.
   *     Queries are given less time, or skipped and counted as errors, so that the collector's own
   *     metrics are still written before it.
   */
  public Result collect(Map<String, Object> event, long deadlineMillis) {
    long started = clock.millis();
    TargetResolver.Resolved resolved;
    try {
      resolved = resolver.resolve(event);
    } catch (SecretUnavailableException e) {
      // The engine may only be recorded in the secret, so it is not known here.
      log.error("Secret unavailable", e.targetId(), null, null, e);
      emf.write(started, e.targetId(), null, SELF, Map.of(), SELF_UNITS, Map.of("Up", 0.0));
      return new Result(e.targetId(), false, 0, 0);
    }
    Target target = resolved.target();
    Map<String, Double> self = new LinkedHashMap<>();

    ConnectionCache.Lease lease;
    try {
      lease = connections.get(target, resolved.credentials());
    } catch (SQLException | RuntimeException e) {
      log.error("Connection failed", target, null, e);
      if (target.secretId() != null && isAuthenticationFailure(e)) {
        // The secret may have been rotated since it was cached. Other failures, such as a database
        // that is down, keep the cached secret so they do not cost a Secrets Manager call each
        // time.
        onLoginFailure.accept(target.secretId());
      }
      self.put("Up", 0.0);
      writeSelf(started, target, self);
      return new Result(target.id(), false, 0, 0);
    }
    self.put("Up", 1.0);
    if (lease.opened()) {
      self.put("ConnectMillis", (double) (clock.millis() - started));
    }

    int succeeded = 0;
    int failed = 0;
    boolean broken = false;
    // Rounded rather than truncated: a schedule that fires a little before the minute would
    // otherwise count as the previous minute and skip queries due this one.
    long epochMinute = (started + 30_000) / 60_000;
    List<QueryDefinition> candidates = new ArrayList<>(queries.apply(target.engine()));
    failed += addQuerySets(target, resolved.querySets(), candidates);
    for (QueryDefinition query : candidates) {
      if (!query.isDue(epochMinute)) {
        continue;
      }
      long remainingSeconds = (deadlineMillis - RESERVED_MILLIS - clock.millis()) / 1000;
      if (remainingSeconds < 1) {
        failed++;
        log.error("Query skipped", target, query.name(), new SQLException("Out of time"));
        continue;
      }
      int timeout = (int) Math.min(queryTimeoutSeconds, remainingSeconds);
      try {
        List<Emf.Unit> units =
            query.metrics().stream().map(m -> new Emf.Unit(m.name(), m.unit())).toList();
        QueryRunner.Result result = runner.run(lease.connection(), query, timeout);
        for (QueryRunner.Row row : result.rows()) {
          emf.write(started, target, query.name(), row.dimensions(), units, row.values());
        }
        if (result.truncated()) {
          log.warn("Query result truncated", target, query.name(), result.rows().size());
        }
        succeeded++;
      } catch (SQLException e) {
        failed++;
        log.error("Query failed", target, query.name(), e);
        broken = broken || isConnectionBroken(lease.connection(), e);
      }
    }
    if (broken) {
      // Start fresh next time. A query that fails for another reason, such as a missing
      // privilege, keeps the connection, which is validated before it is reused anyway.
      connections.discard(target.id());
    }

    self.put("QueryErrors", (double) failed);
    self.put("CollectMillis", (double) (clock.millis() - started));
    writeSelf(started, target, self);
    return new Result(target.id(), true, succeeded, failed);
  }

  /**
   * Adds the queries of each custom query set the target names. A set that cannot be loaded, or one
   * beyond {@link QuerySets#MAX_PER_TARGET}, is logged and counted as one error; it does not stop
   * the other queries.
   *
   * @return the number of sets that could not be used
   */
  private int addQuerySets(Target target, List<String> names, List<QueryDefinition> into) {
    int failed = 0;
    for (int i = 0; i < names.size(); i++) {
      String name = names.get(i);
      if (i >= QuerySets.MAX_PER_TARGET) {
        failed++;
        log.error(
            "Query set skipped",
            target,
            name,
            new IllegalArgumentException(
                "At most " + QuerySets.MAX_PER_TARGET + " query sets may be named"));
        continue;
      }
      try {
        into.addAll(querySets.get(QuerySets.Ref.parse(name)));
      } catch (RuntimeException e) {
        failed++;
        log.error("Query set unavailable", target, name, e);
      }
    }
    return failed;
  }

  /**
   * Whether a failed query may have left the connection unusable: a connection exception (SQLState
   * class 08), a timeout, whose cancellation may still be in flight, or a closed connection.
   */
  private static boolean isConnectionBroken(Connection connection, SQLException e) {
    if (e instanceof SQLTimeoutException || hasSqlStateClass(e, "08")) {
      return true;
    }
    try {
      return connection.isClosed();
    } catch (SQLException closed) {
      return true;
    }
  }

  /**
   * Whether a login failed because the credentials were rejected (SQLState class 28, invalid
   * authorization), which PostgreSQL reports as 28P01 or 28000 and MariaDB Connector/J as 28000.
   */
  private static boolean isAuthenticationFailure(Throwable e) {
    for (Throwable cause = e; cause != null; cause = cause.getCause()) {
      if (cause instanceof SQLException sql && hasSqlStateClass(sql, "28")) {
        return true;
      }
    }
    return false;
  }

  private static boolean hasSqlStateClass(SQLException e, String sqlStateClass) {
    return e.getSQLState() != null && e.getSQLState().startsWith(sqlStateClass);
  }

  private void writeSelf(long timestamp, Target target, Map<String, Double> values) {
    emf.write(timestamp, target, SELF, Map.of(), SELF_UNITS, values);
  }
}
