package io.truemark.databasecollector;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import org.junit.jupiter.api.Test;

class TrustStoreTest {

  @Test
  void defaultTrustIncludesRdsAndPublicAuthorities() throws Exception {
    TrustStore.install();

    TrustManagerFactory factory =
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    factory.init((KeyStore) null);
    X509Certificate[] issuers =
        ((X509TrustManager) factory.getTrustManagers()[0]).getAcceptedIssuers();

    assertTrue(anySubjectContains(issuers, "Amazon RDS"), "RDS authorities are trusted");
    assertTrue(anySubjectContains(issuers, "Amazon Root CA 1"), "public authorities are kept");
  }

  private static boolean anySubjectContains(X509Certificate[] certificates, String text) {
    return Arrays.stream(certificates)
        .anyMatch(c -> c.getSubjectX500Principal().getName().contains(text));
  }
}
