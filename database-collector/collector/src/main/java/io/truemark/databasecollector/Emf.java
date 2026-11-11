package io.truemark.databasecollector;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Writes metrics as one JSON log line per set of dimensions.
 *
 * <p>With a namespace the lines follow the CloudWatch embedded metric format, so CloudWatch turns
 * them into metrics. Without one they are the same JSON minus the {@code _aws} directive: still
 * structured logs, but nothing is published as a metric.
 */
public class Emf {
  /** Top-level keys the writer sets itself; queries may not use them as names. */
  static final Set<String> RESERVED_KEYS = Set.of("_aws", "Target", "Engine", "Query");

  /** A metric name with its CloudWatch unit. */
  public record Unit(String name, String unit) {}

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final String namespace;
  private final Consumer<String> out;

  /**
   * @param namespace CloudWatch namespace, or null or blank to write plain JSON
   * @param out receives each log line
   */
  public Emf(String namespace, Consumer<String> out) {
    this.namespace = namespace == null || namespace.isBlank() ? null : namespace;
    this.out = out;
  }

  /**
   * @param query name of the query the values came from; logged but not a dimension
   * @param dimensions dimensions in addition to the target
   * @param units name and unit of every metric that may appear in {@code values}
   * @param values metric values keyed by metric name
   */
  public void write(
      long timestampMillis,
      Target target,
      String query,
      Map<String, String> dimensions,
      List<Unit> units,
      Map<String, Double> values) {
    write(timestampMillis, target.id(), target.engine().id(), query, dimensions, units, values);
  }

  /**
   * @param engine engine name, or null when it is not known because the target could not be
   *     resolved
   */
  public void write(
      long timestampMillis,
      String targetId,
      String engine,
      String query,
      Map<String, String> dimensions,
      List<Unit> units,
      Map<String, Double> values) {
    if (values.isEmpty()) {
      return;
    }
    ObjectNode line = MAPPER.createObjectNode();
    if (namespace != null) {
      ObjectNode aws = line.putObject("_aws");
      aws.put("Timestamp", timestampMillis);
      ObjectNode directive = aws.putArray("CloudWatchMetrics").addObject();
      directive.put("Namespace", namespace);
      ArrayNode dimensionSet = directive.putArray("Dimensions").addArray();
      dimensionSet.add("Target");
      dimensions.keySet().forEach(dimensionSet::add);
      ArrayNode metrics = directive.putArray("Metrics");
      for (Unit unit : units) {
        if (values.containsKey(unit.name())) {
          metrics.addObject().put("Name", unit.name()).put("Unit", unit.unit());
        }
      }
    } else {
      line.put("timestamp", timestampMillis);
    }
    line.put("Target", targetId);
    if (engine != null) {
      line.put("Engine", engine);
    }
    line.put("Query", query);
    dimensions.forEach(line::put);
    values.forEach(line::put);
    try {
      out.accept(MAPPER.writeValueAsString(line));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
