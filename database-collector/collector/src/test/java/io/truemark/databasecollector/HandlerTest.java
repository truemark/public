package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.amazonaws.services.lambda.runtime.Context;
import java.lang.reflect.Proxy;
import java.util.Map;
import org.junit.jupiter.api.Test;

class HandlerTest {

  /** A Lambda context that only knows how much time is left. */
  private static Context context(int remainingMillis) {
    return (Context)
        Proxy.newProxyInstance(
            Context.class.getClassLoader(),
            new Class<?>[] {Context.class},
            (proxy, method, args) -> {
              if (method.getName().equals("getRemainingTimeInMillis")) {
                return remainingMillis;
              }
              throw new UnsupportedOperationException(method.getName());
            });
  }

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

    Collector.Result result = new Handler().handleRequest(event, context(50_000));

    assertEquals(new Collector.Result("db1", false, 0, 0), result);
  }
}
