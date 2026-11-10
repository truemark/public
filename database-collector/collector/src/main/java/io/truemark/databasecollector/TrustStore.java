package io.truemark.databasecollector;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Makes the JVM trust the Amazon RDS certificate authorities in addition to its default ones.
 *
 * <p>RDS server certificates are issued by RDS-specific CAs that are not in the JVM's default trust
 * store, so without this a verified TLS connection to RDS fails. The CA bundle ships as {@code
 * rds-global-bundle.pem}; refresh it from
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem when AWS adds CAs.
 */
public final class TrustStore {
  private static final Path FILE = Path.of("/tmp/database-collector-truststore.p12");
  private static final String PASSWORD = "changeit";
  private static final String BUNDLE = "/rds-global-bundle.pem";

  private TrustStore() {}

  /**
   * Writes the combined trust store and makes it the JVM default. Must run before anything opens a
   * TLS connection, and again on every invocation in case the file was removed.
   */
  public static synchronized void install() {
    if (!Files.exists(FILE)) {
      try (OutputStream out = Files.newOutputStream(FILE)) {
        build().store(out, PASSWORD.toCharArray());
      } catch (IOException e) {
        throw new UncheckedIOException(e);
      } catch (GeneralSecurityException e) {
        throw new IllegalStateException(e);
      }
    }
    System.setProperty("javax.net.ssl.trustStore", FILE.toString());
    System.setProperty("javax.net.ssl.trustStoreType", "PKCS12");
    System.setProperty("javax.net.ssl.trustStorePassword", PASSWORD);
  }

  private static KeyStore build() throws GeneralSecurityException, IOException {
    KeyStore store = KeyStore.getInstance("PKCS12");
    store.load(null, null);
    int index = 0;

    // The JVM's own default trust store, read before the system properties above replace it.
    System.clearProperty("javax.net.ssl.trustStore");
    System.clearProperty("javax.net.ssl.trustStoreType");
    System.clearProperty("javax.net.ssl.trustStorePassword");
    TrustManagerFactory factory =
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    factory.init((KeyStore) null);
    for (TrustManager manager : factory.getTrustManagers()) {
      if (manager instanceof X509TrustManager x509) {
        for (X509Certificate certificate : x509.getAcceptedIssuers()) {
          store.setCertificateEntry("ca-" + index++, certificate);
        }
      }
    }

    try (InputStream in = TrustStore.class.getResourceAsStream(BUNDLE)) {
      if (in == null) {
        throw new IllegalStateException("Missing resource " + BUNDLE);
      }
      for (Certificate certificate :
          CertificateFactory.getInstance("X.509").generateCertificates(in)) {
        store.setCertificateEntry("ca-" + index++, certificate);
      }
    }
    return store;
  }
}
