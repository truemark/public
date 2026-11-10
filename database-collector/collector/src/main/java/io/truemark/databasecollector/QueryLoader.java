package io.truemark.databasecollector;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;

/** Reads query definitions from YAML. */
public final class QueryLoader {
  private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());

  private QueryLoader() {}

  /** Loads the queries shipped with the collector for an engine. */
  public static List<QueryDefinition> builtIn(Engine engine) {
    String resource = "/queries/" + engine.id() + ".yaml";
    try (InputStream in = QueryLoader.class.getResourceAsStream(resource)) {
      if (in == null) {
        throw new IllegalStateException("Missing resource " + resource);
      }
      return YAML.readValue(in, new TypeReference<List<QueryDefinition>>() {});
    } catch (IOException e) {
      throw new UncheckedIOException("Invalid query definitions in " + resource, e);
    }
  }

  /** Parses query definitions from YAML text. */
  public static List<QueryDefinition> parse(String yaml) {
    try {
      return YAML.readValue(yaml, new TypeReference<List<QueryDefinition>>() {});
    } catch (IOException e) {
      throw new UncheckedIOException("Invalid query definitions", e);
    }
  }
}
