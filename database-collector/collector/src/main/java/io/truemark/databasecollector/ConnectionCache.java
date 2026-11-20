package io.truemark.databasecollector;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Properties;
import java.util.function.Supplier;

/**
 * Keeps one open connection per target between invocations, so a database collected every minute is
 * not logged in to every minute.
 *
 * <p>Not thread-safe: a Lambda execution environment handles one invocation at a time.
 */
public class ConnectionCache {
  /** A connection and whether it was opened by this call. */
  public record Lease(Connection connection, boolean opened) {}

  private record Entry(Connection connection, Target target, Instant lastUsed) {}

  private static final int VALIDATION_TIMEOUT_SECONDS = 2;

  /** Opens a connection to a target. */
  @FunctionalInterface
  public interface Opener {
    Connection open(Target target, Credentials credentials) throws SQLException;
  }

  private final Opener opener;
  private final Duration idleTimeout;
  private final int maxConnections;
  private final Clock clock;
  private final Map<String, Entry> entries = new HashMap<>();

  public ConnectionCache(Opener opener, Duration idleTimeout, int maxConnections, Clock clock) {
    this.opener = opener;
    this.idleTimeout = idleTimeout;
    this.maxConnections = maxConnections;
    this.clock = clock;
  }

  /**
   * Returns the cached connection for the target when it is still usable, otherwise opens one.
   *
   * @param credentials asked for credentials only when a connection has to be opened
   */
  public Lease get(Target target, Supplier<Credentials> credentials) throws SQLException {
    Instant now = clock.instant();
    evictIdle(now);

    Entry entry = entries.get(target.id());
    if (entry != null) {
      if (entry.target().equals(target) && isValid(entry.connection())) {
        entries.put(target.id(), new Entry(entry.connection(), target, now));
        return new Lease(entry.connection(), false);
      }
      discard(target.id());
    }

    if (entries.size() >= maxConnections) {
      entries.entrySet().stream()
          .min(Map.Entry.comparingByValue((a, b) -> a.lastUsed().compareTo(b.lastUsed())))
          .map(Map.Entry::getKey)
          .ifPresent(this::discard);
    }

    Connection connection = opener.open(target, credentials.get());
    entries.put(target.id(), new Entry(connection, target, now));
    return new Lease(connection, true);
  }

  /** Closes and forgets the connection for a target. */
  public void discard(String targetId) {
    Entry entry = entries.remove(targetId);
    if (entry != null) {
      closeQuietly(entry.connection());
    }
  }

  /** Closes every connection. Network connections must not be captured in a snapshot. */
  public void closeAll() {
    entries.values().forEach(entry -> closeQuietly(entry.connection()));
    entries.clear();
  }

  int size() {
    return entries.size();
  }

  private void evictIdle(Instant now) {
    Iterator<Entry> iterator = entries.values().iterator();
    while (iterator.hasNext()) {
      Entry entry = iterator.next();
      if (entry.lastUsed().plus(idleTimeout).isBefore(now)) {
        closeQuietly(entry.connection());
        iterator.remove();
      }
    }
  }

  /** Opens a JDBC connection with the engine's settings and makes the session read-only. */
  public static Connection open(Target target, Credentials credentials) throws SQLException {
    Properties props = target.engine().connectionProperties(target.tls());
    props.setProperty("user", credentials.username());
    props.setProperty("password", credentials.password());
    Connection connection = DriverManager.getConnection(target.jdbcUrl(), props);
    try (Statement statement = connection.createStatement()) {
      for (String sql : target.engine().sessionSetup()) {
        statement.execute(sql);
      }
    } catch (SQLException e) {
      closeQuietly(connection);
      throw e;
    }
    return connection;
  }

  private static boolean isValid(Connection connection) {
    try {
      return connection.isValid(VALIDATION_TIMEOUT_SECONDS);
    } catch (SQLException e) {
      return false;
    }
  }

  private static void closeQuietly(Connection connection) {
    try {
      connection.close();
    } catch (SQLException e) {
      // The connection is being thrown away; there is nothing useful to do with a close failure.
    }
  }
}
