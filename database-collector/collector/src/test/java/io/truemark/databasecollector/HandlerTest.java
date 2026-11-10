package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import org.junit.jupiter.api.Test;

class HandlerTest {

  /**
   * Exercises the real wiring up to the network: the IAM token is signed locally, then the
   * connection to a port nothing listens on is refused.
   */
  @Test
  void reportsUnreachableDatabaseAsDown() {
    Map<String, Object> event =
        Map.of(
            "id", "db1",
            "engine", "postgres",
            "host", "127.0.0.1",
            "port", 1,
            "username", "database_collector");

    Collector.Result result = new Handler().handleRequest(event, null);

    assertEquals(new Collector.Result("db1", false, 0, 0), result);
  }
}
