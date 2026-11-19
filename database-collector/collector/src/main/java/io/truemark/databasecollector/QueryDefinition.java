package io.truemark.databasecollector;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.io.IOException;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A query whose result rows become metrics.
 *
 * @param name identifies the query in logs
 * @param sql statement to run; it must only read
 * @param interval minutes between runs, 1 when omitted. In YAML it may also be written with a unit:
 *     {@code 15m}, {@code 2h} or {@code 1d}. Runs are aligned to the epoch, so {@code 1h} runs at
 *     minute 0 of every hour and {@code 1d} at 00:00 UTC.
 * @param dimensions result columns whose values distinguish one row's metrics from another's
 * @param metrics result columns holding the numbers to report
 */
public record QueryDefinition(
    String name,
    String sql,
    @JsonDeserialize(using = QueryDefinition.IntervalDeserializer.class) Integer interval,
    List<String> dimensions,
    List<Metric> metrics) {

  private static final Pattern INTERVAL = Pattern.compile("(\\d+)\\s*([mhd]?)");

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

  /** Returns a copy of this query under another name, for example to qualify it by its set. */
  QueryDefinition withName(String newName) {
    return new QueryDefinition(newName, sql, interval, dimensions, metrics);
  }

  /**
   * Parses an interval: a whole number of minutes, optionally followed by {@code m}, {@code h} or
   * {@code d}.
   */
  static int parseInterval(String text) {
    Matcher matcher = INTERVAL.matcher(text.trim().toLowerCase(Locale.ROOT));
    require(matcher.matches(), "Invalid interval: " + text);
    int multiplier =
        switch (matcher.group(2)) {
          case "h" -> 60;
          case "d" -> 24 * 60;
          default -> 1;
        };
    try {
      return Math.multiplyExact(Integer.parseInt(matcher.group(1)), multiplier);
    } catch (ArithmeticException | NumberFormatException e) {
      throw new IllegalArgumentException("Interval too large: " + text);
    }
  }

  /** Reads an interval written as a number of minutes or as text such as {@code 15m}. */
  static final class IntervalDeserializer extends JsonDeserializer<Integer> {
    @Override
    public Integer deserialize(JsonParser parser, DeserializationContext context)
        throws IOException {
      if (parser.currentToken() == JsonToken.VALUE_NUMBER_INT) {
        return parser.getIntValue();
      }
      return parseInterval(parser.getValueAsString(""));
    }
  }

  private static void require(boolean condition, String message) {
    if (!condition) {
      throw new IllegalArgumentException(message);
    }
  }
}
