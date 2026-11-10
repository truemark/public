package io.truemark.databasecollector;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Turns the event the function is invoked with into a {@link Target} and its {@link Credentials}.
 *
 * <p>The event carries these fields. Each one except {@code id} and {@code secretId} may instead
 * come from the secret, using the field names of RDS-managed secrets ({@code engine}, {@code host},
 * {@code port}, {@code dbname}, {@code username}); the event wins when both are present.
 *
 * <ul>
 *   <li>{@code id} (required) identifies the database in logs and metrics
 *   <li>{@code secretId} names the secret to log in with; without it IAM authentication is used
 *   <li>{@code engine}, {@code host} (required from one of the two sources)
 *   <li>{@code port}, {@code database} (default to the engine's defaults)
 *   <li>{@code username} (required for IAM authentication)
 *   <li>{@code tls}: {@code verify} (default), {@code encrypt} or {@code off}
 * </ul>
 */
public class TargetResolver {
  /**
   * A target and the credentials to connect to it with. The credentials are only produced when
   * asked for, because a connection that is already open does not need them.
   */
  public record Resolved(Target target, Supplier<Credentials> credentials) {}

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final SecretSource secrets;
  private final TokenSource tokens;

  public TargetResolver(SecretSource secrets, TokenSource tokens) {
    this.secrets = secrets;
    this.tokens = tokens;
  }

  public Resolved resolve(Map<String, Object> event) {
    String id = required(text(event.get("id")), "id");
    String secretId = text(event.get("secretId"));
    JsonNode secret = secretId == null ? MAPPER.createObjectNode() : readSecret(secretId);

    Engine engine =
        Engine.parse(required(first(text(event.get("engine")), text(secret, "engine")), "engine"));
    String host = required(first(text(event.get("host")), text(secret, "host")), "host");
    String port = first(text(event.get("port")), text(secret, "port"));
    String database = first(text(event.get("database")), text(secret, "dbname"));
    String username = first(text(event.get("username")), text(secret, "username"));
    String tls = text(event.get("tls"));

    Target target =
        new Target(
            id,
            engine,
            host,
            port == null ? engine.defaultPort() : Integer.parseInt(port),
            database == null ? engine.defaultDatabase() : database,
            required(username, "username"),
            secretId,
            tls == null ? Tls.VERIFY : Tls.parse(tls));

    if (secretId == null) {
      return new Resolved(
          target,
          () ->
              new Credentials(
                  target.username(),
                  tokens.token(target.host(), target.port(), target.username())));
    }
    // Taken verbatim: unlike the other fields, surrounding whitespace is part of a password.
    JsonNode passwordNode = secret.get("password");
    if (passwordNode == null || passwordNode.isNull() || passwordNode.asText().isEmpty()) {
      throw new IllegalArgumentException("Missing password in secret " + secretId);
    }
    String password = passwordNode.asText();
    return new Resolved(target, () -> new Credentials(target.username(), password));
  }

  private JsonNode readSecret(String secretId) {
    try {
      return MAPPER.readTree(secrets.get(secretId));
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      // The parser's message can quote the secret, so it is deliberately not included.
      throw new IllegalArgumentException("Secret " + secretId + " is not valid JSON");
    }
  }

  private static String text(Object value) {
    if (value == null) {
      return null;
    }
    String text =
        value instanceof Number number ? String.valueOf(number.longValue()) : value.toString();
    return text.isBlank() ? null : text.trim();
  }

  private static String text(JsonNode node, String field) {
    JsonNode value = node.get(field);
    return value == null || value.isNull() ? null : text(value.asText());
  }

  private static String first(String a, String b) {
    return a != null ? a : b;
  }

  private static String required(String value, String name) {
    if (value == null) {
      throw new IllegalArgumentException("Missing " + name);
    }
    return value;
  }
}
