package io.truemark.databasecollector;

/** Database user name and password, or IAM authentication token in place of the password. */
public record Credentials(String username, String password) {

  @Override
  public String toString() {
    return "Credentials[username=" + username + "]";
  }
}
