package io.truemark.databasecollector;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import java.sql.Driver;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import org.crac.Core;
import org.crac.Resource;

/**
 * Lambda entry point. One invocation collects metrics from one database.
 *
 * <p>The function runs with SnapStart, so everything that is expensive and safe to share is done
 * before the snapshot is taken (see {@link #beforeCheckpoint}). Network connections do not survive
 * a snapshot and must only ever be opened while handling a request.
 */
public class Handler implements RequestHandler<Map<String, Object>, Map<String, Object>>, Resource {

  public Handler() {
    Core.getGlobalContext().register(this);
  }

  @Override
  public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
    // Scaffold only: collection is not implemented yet.
    return Map.of("drivers", driverClassNames());
  }

  @Override
  public void beforeCheckpoint(org.crac.Context<? extends Resource> context) {
    // Forces every bundled JDBC driver to load and register so that work is captured in the
    // snapshot instead of being paid for on the first request.
    driverClassNames();
  }

  @Override
  public void afterRestore(org.crac.Context<? extends Resource> context) {
    // Nothing to restore yet.
  }

  /** Returns the class names of every JDBC driver found on the classpath. */
  static List<String> driverClassNames() {
    return DriverManager.drivers().map(Driver::getClass).map(Class::getName).sorted().toList();
  }
}
