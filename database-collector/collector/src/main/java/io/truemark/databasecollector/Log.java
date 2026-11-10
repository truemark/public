package io.truemark.databasecollector;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/** Writes operational messages as JSON log lines. */
public class Log {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final Consumer<String> out;

  public Log(Consumer<String> out) {
    this.out = out;
  }

  public void error(String message, Target target, String query, Throwable cause) {
    Map<String, Object> line = new LinkedHashMap<>();
    line.put("level", "ERROR");
    line.put("message", message);
    line.put("Target", target.id());
    line.put("Engine", target.engine().id());
    if (query != null) {
      line.put("Query", query);
    }
    line.put("error", cause.getMessage());
    line.put("errorType", cause.getClass().getName());
    try {
      out.accept(MAPPER.writeValueAsString(line));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
