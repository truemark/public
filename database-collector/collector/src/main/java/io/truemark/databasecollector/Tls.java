package io.truemark.databasecollector;

import java.util.Locale;

/** How the connection to the database is protected. */
public enum Tls {
  /** Encrypted, and the server certificate and host name are verified. */
  VERIFY,
  /** Encrypted, but the server certificate is not verified. */
  ENCRYPT,
  /** Not encrypted. */
  OFF;

  static Tls parse(String name) {
    return valueOf(name.toUpperCase(Locale.ROOT));
  }
}
