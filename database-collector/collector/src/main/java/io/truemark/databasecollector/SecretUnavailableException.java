package io.truemark.databasecollector;

/**
 * The secret for a target could not be read, for example because Secrets Manager timed out, denied
 * access or no longer has it. Unlike an event that does not describe a database, this is an
 * operational failure of one collection.
 */
public class SecretUnavailableException extends RuntimeException {
  private final String targetId;
  private final String secretId;

  public SecretUnavailableException(String targetId, String secretId, Throwable cause) {
    super("Secret " + secretId + " could not be read: " + cause.getMessage(), cause);
    this.targetId = targetId;
    this.secretId = secretId;
  }

  public String targetId() {
    return targetId;
  }

  public String secretId() {
    return secretId;
  }
}
