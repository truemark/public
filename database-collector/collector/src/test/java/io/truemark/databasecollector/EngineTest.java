package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class EngineTest {

  @ParameterizedTest
  @ValueSource(strings = {"postgres", "aurora-postgresql"})
  void parsesPostgresql(String name) {
    assertEquals(Engine.POSTGRESQL, Engine.parse(name));
  }

  @ParameterizedTest
  @ValueSource(strings = {"mysql", "aurora-mysql", "mariadb", "aurora", "MySQL"})
  void parsesMysql(String name) {
    assertEquals(Engine.MYSQL, Engine.parse(name));
  }

  @ParameterizedTest
  @ValueSource(strings = {"oracle-ee", "sqlserver-se", "aurora-other"})
  void rejectsOtherEngines(String name) {
    assertThrows(IllegalArgumentException.class, () -> Engine.parse(name));
  }
}
