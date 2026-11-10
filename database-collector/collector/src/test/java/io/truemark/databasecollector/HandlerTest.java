package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.sql.DriverManager;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class HandlerTest {

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

  @org.junit.jupiter.api.Test
  void handlerReportsBundledDrivers() {
    @SuppressWarnings("unchecked")
    List<String> drivers =
        (List<String>) new Handler().handleRequest(java.util.Map.of(), null).get("drivers");
    assertEquals(4, drivers.size(), drivers.toString());
  }
}
