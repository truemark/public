package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import java.sql.DriverManager;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class DriversTest {

  @ParameterizedTest
  @ValueSource(
      strings = {
        "jdbc:postgresql://localhost/test",
        "jdbc:mariadb://localhost/test",
        "jdbc:oracle:thin:@//localhost/test",
        "jdbc:sqlserver://localhost;databaseName=test"
      })
  void bundlesDriverFor(String url) {
    assertDoesNotThrow(() -> DriverManager.getDriver(url));
  }
}
