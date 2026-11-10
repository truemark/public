package io.truemark.databasecollector;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps secrets in memory for a short time so that a database collected every minute does not cause
 * a Secrets Manager call every minute.
 */
public class CachingSecretSource implements SecretSource {
  private record Entry(String value, Instant fetched) {}

  private final SecretSource delegate;
  private final Duration ttl;
  private final Clock clock;
  private final Map<String, Entry> entries = new ConcurrentHashMap<>();

  public CachingSecretSource(SecretSource delegate, Duration ttl, Clock clock) {
    this.delegate = delegate;
    this.ttl = ttl;
    this.clock = clock;
  }

  @Override
  public String get(String secretId) {
    Instant now = clock.instant();
    Entry entry = entries.get(secretId);
    if (entry == null || entry.fetched().plus(ttl).isBefore(now)) {
      entry = new Entry(delegate.get(secretId), now);
      entries.put(secretId, entry);
    }
    return entry.value();
  }

  /** Forgets a secret, for example after a login with it failed because it was rotated. */
  public void invalidate(String secretId) {
    entries.remove(secretId);
  }

  /** Forgets every secret so none is captured in a SnapStart snapshot. */
  public void clear() {
    entries.clear();
  }
}
