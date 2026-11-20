package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import java.util.Properties;
import org.junit.jupiter.api.Test;
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
  @ValueSource(
      strings = {"oracle-ee", "oracle-se2", "oracle-ee-cdb", "oracle-se2-cdb", "custom-oracle-ee"})
  void parsesOracle(String name) {
    assertEquals(Engine.ORACLE, Engine.parse(name));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "sqlserver-ee",
        "sqlserver-se",
        "sqlserver-ex",
        "sqlserver-web",
        "custom-sqlserver-ee"
      })
  void parsesSqlServer(String name) {
    assertEquals(Engine.SQLSERVER, Engine.parse(name));
  }

  @ParameterizedTest
  @ValueSource(strings = {"db2-se", "aurora-other"})
  void rejectsOtherEngines(String name) {
    assertThrows(IllegalArgumentException.class, () -> Engine.parse(name));
  }

  @Test
  void oracleUsesTcpsOnlyWhenVerifying() {
    assertEquals(
        "jdbc:oracle:thin:@tcps://db.example.com:2484/ORCL",
        Engine.ORACLE.jdbcUrl("db.example.com", 2484, "ORCL", Tls.VERIFY));
    assertEquals(
        "jdbc:oracle:thin:@tcp://db.example.com:1521/ORCL",
        Engine.ORACLE.jdbcUrl("db.example.com", 1521, "ORCL", Tls.ENCRYPT));
    assertEquals(
        "REQUIRED",
        Engine.ORACLE
            .connectionProperties(Tls.ENCRYPT)
            .getProperty("oracle.net.encryption_client"));
  }

  @Test
  void sqlServerEncryptsUnlessTlsIsOff() {
    assertEquals(
        "jdbc:sqlserver://db.example.com:1433;databaseName=master",
        Engine.SQLSERVER.jdbcUrl("db.example.com", 1433, "master", Tls.VERIFY));
    Properties verify = Engine.SQLSERVER.connectionProperties(Tls.VERIFY);
    assertEquals("true", verify.getProperty("encrypt"));
    assertEquals("false", verify.getProperty("trustServerCertificate"));
    assertEquals(
        "true",
        Engine.SQLSERVER.connectionProperties(Tls.ENCRYPT).getProperty("trustServerCertificate"));
    assertEquals("false", Engine.SQLSERVER.connectionProperties(Tls.OFF).getProperty("encrypt"));
  }

  @Test
  void recognizesRejectedLogins() {
    assertTrue(Engine.POSTGRESQL.isLoginRejected(new SQLException("bad", "28P01")));
    assertTrue(Engine.ORACLE.isLoginRejected(new SQLException("ORA-01017", "72000", 1017)));
    assertTrue(Engine.SQLSERVER.isLoginRejected(new SQLException("Login failed", "S0001", 18456)));
    assertFalse(Engine.ORACLE.isLoginRejected(new SQLException("ORA-12541", "08006", 12541)));
    assertFalse(Engine.SQLSERVER.isLoginRejected(new SQLException("refused", "08S01", 0)));
  }

  @Test
  void onlyPostgresqlAndMysqlSupportIamAuthentication() {
    assertTrue(Engine.POSTGRESQL.supportsIamAuthentication());
    assertTrue(Engine.MYSQL.supportsIamAuthentication());
    assertFalse(Engine.ORACLE.supportsIamAuthentication());
    assertFalse(Engine.SQLSERVER.supportsIamAuthentication());
  }
}
