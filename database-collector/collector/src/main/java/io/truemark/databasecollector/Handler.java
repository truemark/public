package io.truemark.databasecollector;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import java.nio.charset.StandardCharsets;
import java.sql.Driver;
import java.sql.DriverManager;
import java.time.Clock;
import java.time.Duration;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.crac.Core;
import org.crac.Resource;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.rds.RdsUtilities;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.ssm.SsmClient;

/**
 * Lambda entry point. One invocation collects metrics from one database; see {@link TargetResolver}
 * for the event it expects.
 *
 * <p>The function runs with SnapStart, so everything that is expensive and safe to share is done
 * before the snapshot is taken (see {@link #beforeCheckpoint}). Network connections and secrets
 * must not be captured in the snapshot.
 *
 * <p>Environment: {@code METRICS_NAMESPACE}; {@code QUERY_SET_BUCKET} and {@code
 * QUERY_SET_PARAMETER_PATH} enable custom query sets from S3 and SSM Parameter Store.
 */
public class Handler implements RequestHandler<Map<String, Object>, Collector.Result>, Resource {
  private static final Duration SECRET_TTL = Duration.ofMinutes(5);
  private static final Duration AWS_ATTEMPT_TIMEOUT = Duration.ofSeconds(4);
  private static final Duration AWS_CALL_TIMEOUT = Duration.ofSeconds(10);
  private static final Duration CONNECTION_IDLE_TIMEOUT = Duration.ofMinutes(5);
  private static final int MAX_CONNECTIONS = 20;
  private static final int MAX_SECRETS = 20;
  private static final int QUERY_TIMEOUT_SECONDS = 10;
  private static final int MAX_ROWS = 100;
  private static final Duration QUERY_SET_TTL = Duration.ofMinutes(5);
  private static final Duration QUERY_SET_FAILURE_TTL = Duration.ofMinutes(1);
  private static final int MAX_QUERY_SETS = 50;

  /** Key prefix of query sets in the bucket; a set is {@code <prefix><name>.yaml}. */
  static final String QUERY_SET_KEY_PREFIX = "query-sets/";

  static {
    TrustStore.install();
  }

  private final Map<Engine, List<QueryDefinition>> builtInQueries = new EnumMap<>(Engine.class);
  private final CachingSecretSource secrets;
  private final ConnectionCache connections;
  private final QuerySets querySets;
  private final Collector collector;

  public Handler() {
    Clock clock = Clock.systemUTC();
    Region region = Region.of(System.getenv("AWS_REGION"));
    DefaultCredentialsProvider awsCredentials = DefaultCredentialsProvider.builder().build();

    SecretsManagerClient secretsManager =
        SecretsManagerClient.builder()
            .region(region)
            .credentialsProvider(awsCredentials)
            .httpClient(UrlConnectionHttpClient.create())
            .overrideConfiguration(Handler::timeouts)
            .build();
    secrets =
        new CachingSecretSource(
            id -> secretsManager.getSecretValue(r -> r.secretId(id)).secretString(),
            SECRET_TTL,
            MAX_SECRETS,
            clock);

    RdsUtilities rds =
        RdsUtilities.builder().region(region).credentialsProvider(awsCredentials).build();
    TokenSource tokens =
        (host, port, username) ->
            rds.generateAuthenticationToken(r -> r.hostname(host).port(port).username(username));

    Map<QuerySets.Source, QuerySets.Fetcher> fetchers = new HashMap<>();
    String bucket = blankToNull(System.getenv("QUERY_SET_BUCKET"));
    if (bucket != null) {
      S3Client s3 =
          S3Client.builder()
              .region(region)
              .credentialsProvider(awsCredentials)
              .httpClient(UrlConnectionHttpClient.create())
              .overrideConfiguration(Handler::timeouts)
              .build();
      fetchers.put(QuerySets.Source.S3, name -> fetchFromS3(s3, bucket, name));
    }
    String parameterPath = blankToNull(System.getenv("QUERY_SET_PARAMETER_PATH"));
    if (parameterPath != null) {
      String prefix = parameterPath.endsWith("/") ? parameterPath : parameterPath + "/";
      SsmClient ssm =
          SsmClient.builder()
              .region(region)
              .credentialsProvider(awsCredentials)
              .httpClient(UrlConnectionHttpClient.create())
              .overrideConfiguration(Handler::timeouts)
              .build();
      fetchers.put(
          QuerySets.Source.SSM,
          name ->
              ssm.getParameter(r -> r.name(prefix + name).withDecryption(true))
                  .parameter()
                  .value());
    }
    querySets =
        new QuerySets(fetchers, QUERY_SET_TTL, QUERY_SET_FAILURE_TTL, MAX_QUERY_SETS, clock);

    for (Engine engine : Engine.values()) {
      builtInQueries.put(engine, QueryLoader.builtIn(engine));
    }
    connections =
        new ConnectionCache(ConnectionCache::open, CONNECTION_IDLE_TIMEOUT, MAX_CONNECTIONS, clock);
    collector =
        new Collector(
            new TargetResolver(secrets, tokens),
            connections,
            new QueryRunner(MAX_ROWS),
            QUERY_TIMEOUT_SECONDS,
            builtInQueries::get,
            querySets,
            new Emf(System.getenv("METRICS_NAMESPACE"), System.out::println),
            new Log(System.out::println),
            clock,
            secrets::invalidate);

    Core.getGlobalContext().register(this);
  }

  @Override
  public Collector.Result handleRequest(Map<String, Object> event, Context context) {
    TrustStore.install();
    return collector.collect(
        event, System.currentTimeMillis() + context.getRemainingTimeInMillis());
  }

  @Override
  public void beforeCheckpoint(org.crac.Context<? extends Resource> context) {
    // Forces every bundled JDBC driver to load and register so that work is captured in the
    // snapshot instead of being paid for on the first request.
    driverClassNames();
    connections.closeAll();
    secrets.clear();
    querySets.clear();
  }

  @Override
  public void afterRestore(org.crac.Context<? extends Resource> context) {
    // Connections and secrets are re-established on demand.
  }

  /**
   * Without a route to the service the default timeouts and retries would outlast the invocation;
   * fail well inside it instead.
   */
  private static void timeouts(ClientOverrideConfiguration.Builder config) {
    config.apiCallAttemptTimeout(AWS_ATTEMPT_TIMEOUT).apiCallTimeout(AWS_CALL_TIMEOUT);
  }

  /** Reads {@code query-sets/<name>.yaml}, refusing one larger than a query set may be. */
  private static String fetchFromS3(S3Client s3, String bucket, String name) {
    byte[] bytes =
        s3.getObjectAsBytes(r ->
                r.bucket(bucket)
                    .key(QUERY_SET_KEY_PREFIX + name + ".yaml")
                    // One byte more than allowed tells a set that is too large from one that
                    // fills the limit, without downloading all of it.
                    .range("bytes=0-" + QuerySets.MAX_LENGTH))
            .asByteArray();
    if (bytes.length > QuerySets.MAX_LENGTH) {
      throw new IllegalArgumentException(
          "Query set is larger than " + QuerySets.MAX_LENGTH + " bytes");
    }
    return new String(bytes, StandardCharsets.UTF_8);
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  /** Returns the class names of every JDBC driver found on the classpath. */
  static List<String> driverClassNames() {
    return DriverManager.drivers().map(Driver::getClass).map(Class::getName).sorted().toList();
  }
}
