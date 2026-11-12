package io.truemark.databasecollector;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A query whose result rows become metrics.
 *
 * @param name identifies the query in logs
 * @param sql statement to run; it must only read
 * @param interval minutes between runs, 1 when omitted
 * @param dimensions result columns whose values distinguish one row's metrics from another's
 * @param metrics result columns holding the numbers to report
 */
public record QueryDefinition(
    String name, String sql, Integer interval, List<String> dimensions, List<Metric> metrics) {

  /**
   * One numeric result column.
   *
   * @param column result column to read
   * @param name metric name
   * @param unit CloudWatch unit, {@code None} when omitted
   */
  public record Metric(String column, String name, String unit) {
    public Metric {
      require(column != null && !column.isBlank(), "A metric needs a column");
      require(name != null && !name.isBlank(), "Metric for column " + column + " needs a name");
      unit = unit == null ? "None" : unit;
    }
  }

  public QueryDefinition {
    require(name != null && !name.isBlank(), "A query needs a name");
    require(sql != null && !sql.isBlank(), "Query " + name + " needs sql");
    interval = interval == null ? 1 : interval;
    require(interval >= 1, "Query " + name + " needs an interval of at least 1");
    dimensions = dimensions == null ? List.of() : List.copyOf(dimensions);
    require(metrics != null && !metrics.isEmpty(), "Query " + name + " needs at least one metric");
    metrics = List.copyOf(metrics);

    Set<String> names = new HashSet<>(Emf.RESERVED_KEYS);
    for (String dimension : dimensions) {
      require(names.add(dimension), "Query " + name + " uses the name " + dimension + " twice");
    }
    for (Metric metric : metrics) {
      require(
          names.add(metric.name()), "Query " + name + " uses the name " + metric.name() + " twice");
    }
  }

  /** Whether the query runs in the given minute, counted from the epoch. */
  boolean isDue(long epochMinute) {
    return epochMinute % interval == 0;
  }

  private static void require(boolean condition, String message) {
    if (!condition) {
      throw new IllegalArgumentException(message);
    }
  }
}
