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
  private final int maxEntries;
  private final Clock clock;
  private final Map<String, Entry> entries = new ConcurrentHashMap<>();

  /**
   * @param maxEntries most secrets held at once; the one fetched longest ago makes room for a new
   *     one
   */
  public CachingSecretSource(SecretSource delegate, Duration ttl, int maxEntries, Clock clock) {
    this.delegate = delegate;
    this.ttl = ttl;
    this.maxEntries = maxEntries;
    this.clock = clock;
  }

  @Override
  public String get(String secretId) {
    Instant now = clock.instant();
    // Expired secrets are dropped whichever one is asked for, so a secret that is no longer used
    // does not stay in memory for the life of the execution environment.
    entries.values().removeIf(entry -> entry.fetched().plus(ttl).isBefore(now));
    Entry entry = entries.get(secretId);
    if (entry == null) {
      entry = new Entry(delegate.get(secretId), now);
      if (entries.size() >= maxEntries) {
        entries.entrySet().stream()
            .min(Map.Entry.comparingByValue((a, b) -> a.fetched().compareTo(b.fetched())))
            .map(Map.Entry::getKey)
            .ifPresent(entries::remove);
      }
      entries.put(secretId, entry);
    }
    return entry.value();
  }

  /** Forgets a secret, for example after a login with it failed because it was rotated. */
  public void invalidate(String secretId) {
    entries.remove(secretId);
  }

  int size() {
    return entries.size();
  }

  /** Forgets every secret so none is captured in a SnapStart snapshot. */
  public void clear() {
    entries.clear();
  }
}
