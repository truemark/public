package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;
import org.junit.jupiter.api.Test;

class TargetResolverTest {
  private static final String SECRET =
      """
      {"engine":"mysql","host":"db.example.com","port":3307,"dbname":"app",
       "username":"monitor","password":"s3cret"}\
      """;

  private final TargetResolver resolver =
      new TargetResolver(
          id -> SECRET, (host, port, username) -> "token:" + host + ":" + port + ":" + username);

  @Test
  void readsConnectionDetailsFromSecret() {
    var resolved = resolver.resolve(Map.of("id", "db1", "secretId", "my-secret"));

    assertEquals(
        new Target(
            "db1", Engine.MYSQL, "db.example.com", 3307, "app", "monitor", "my-secret", Tls.VERIFY),
        resolved.target());
    assertEquals(new Credentials("monitor", "s3cret"), resolved.credentials().get());
  }

  @Test
  void eventOverridesSecret() {
    var resolved =
        resolver.resolve(
            Map.of(
                "id", "db1", "secretId", "my-secret", "host", "other.example.com", "port", 3306));

    assertEquals("other.example.com", resolved.target().host());
    assertEquals(3306, resolved.target().port());
  }

  @Test
  void usesIamTokenWithoutSecret() {
    var resolved =
        resolver.resolve(
            Map.of(
                "id", "db1",
                "engine", "aurora-postgresql",
                "host", "pg.example.com",
                "username", "database_collector"));

    Target target = resolved.target();
    assertEquals(Engine.POSTGRESQL, target.engine());
    assertEquals(5432, target.port());
    assertEquals("postgres", target.database());
    assertNull(target.secretId());
    assertEquals(
        new Credentials("database_collector", "token:pg.example.com:5432:database_collector"),
        resolved.credentials().get());
  }

  @Test
  void keepsWhitespaceAroundPassword() {
    var spaced =
        new TargetResolver(id -> "{\"username\":\"u\",\"password\":\" s3cret \"}", (h, p, u) -> "");

    var resolved =
        spaced.resolve(Map.of("id", "db1", "secretId", "s", "engine", "mysql", "host", "h"));

    assertEquals(" s3cret ", resolved.credentials().get().password());
  }

  @Test
  void rejectsEventWithoutHost() {
    var e =
        assertThrows(
            IllegalArgumentException.class,
            () -> resolver.resolve(Map.of("id", "db1", "engine", "mysql", "username", "u")));
    assertEquals("Missing host", e.getMessage());
  }

  @Test
  void rejectsUnsupportedEngine() {
    assertThrows(
        IllegalArgumentException.class,
        () -> resolver.resolve(Map.of("id", "db1", "engine", "db2", "host", "h", "username", "u")));
  }

  @Test
  void doesNotLeakSecretWhenItIsNotJson() {
    var broken = new TargetResolver(id -> "hunter2 not json", (h, p, u) -> "");
    var e =
        assertThrows(
            IllegalArgumentException.class,
            () -> broken.resolve(Map.of("id", "db1", "secretId", "my-secret")));
    assertFalse(e.getMessage().contains("hunter2"));
  }

  @Test
  void credentialsDoNotPrintPassword() {
    assertFalse(new Credentials("u", "s3cret").toString().contains("s3cret"));
  }
}
