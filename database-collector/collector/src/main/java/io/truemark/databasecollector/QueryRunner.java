package io.truemark.databasecollector;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Runs a {@link QueryDefinition} and turns its result rows into metric values. */
public class QueryRunner {
  /**
   * The metrics read from one result row.
   *
   * @param dimensions dimension column values, in the order the query defines them
   * @param values metric values keyed by metric name; a NULL column is left out
   */
  public record Row(Map<String, String> dimensions, Map<String, Double> values) {}

  private final int timeoutSeconds;
  private final int maxRows;

  /**
   * @param timeoutSeconds how long one query may run
   * @param maxRows rows read from one query; this bounds how many metric series a query can create
   */
  public QueryRunner(int timeoutSeconds, int maxRows) {
    this.timeoutSeconds = timeoutSeconds;
    this.maxRows = maxRows;
  }

  public List<Row> run(Connection connection, QueryDefinition query) throws SQLException {
    List<Row> rows = new ArrayList<>();
    try (Statement statement = connection.createStatement()) {
      statement.setQueryTimeout(timeoutSeconds);
      statement.setMaxRows(maxRows);
      try (ResultSet result = statement.executeQuery(query.sql())) {
        while (result.next()) {
          Map<String, String> dimensions = new LinkedHashMap<>();
          for (String dimension : query.dimensions()) {
            String value = result.getString(dimension);
            dimensions.put(dimension, value == null ? "" : value);
          }
          Map<String, Double> values = new LinkedHashMap<>();
          for (QueryDefinition.Metric metric : query.metrics()) {
            double value = result.getDouble(metric.column());
            if (!result.wasNull() && Double.isFinite(value)) {
              values.put(metric.name(), value);
            }
          }
          rows.add(new Row(dimensions, values));
        }
      }
    }
    return rows;
  }
}
