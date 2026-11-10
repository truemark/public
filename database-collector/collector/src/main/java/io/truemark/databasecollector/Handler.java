package io.truemark.databasecollector;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import java.sql.Driver;
import java.sql.DriverManager;
import java.time.Clock;
import java.time.Duration;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.crac.Core;
import org.crac.Resource;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.rds.RdsUtilities;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

/**
 * Lambda entry point. One invocation collects metrics from one database; see {@link TargetResolver}
 * for the event it expects.
 *
 * <p>The function runs with SnapStart, so everything that is expensive and safe to share is done
 * before the snapshot is taken (see {@link #beforeCheckpoint}). Network connections and secrets
 * must not be captured in the snapshot.
 */
public class Handler implements RequestHandler<Map<String, Object>, Collector.Result>, Resource {
  private static final Duration SECRET_TTL = Duration.ofMinutes(5);
  private static final Duration CONNECTION_IDLE_TIMEOUT = Duration.ofMinutes(5);
  private static final int MAX_CONNECTIONS = 20;
  private static final int QUERY_TIMEOUT_SECONDS = 10;
  private static final int MAX_ROWS = 100;

  static {
    TrustStore.install();
  }

  private final Map<Engine, List<QueryDefinition>> builtInQueries = new EnumMap<>(Engine.class);
  private final CachingSecretSource secrets;
  private final ConnectionCache connections;
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
            .build();
    secrets =
        new CachingSecretSource(
            id -> secretsManager.getSecretValue(r -> r.secretId(id)).secretString(),
            SECRET_TTL,
            clock);

    RdsUtilities rds =
        RdsUtilities.builder().region(region).credentialsProvider(awsCredentials).build();
    TokenSource tokens =
        (host, port, username) ->
            rds.generateAuthenticationToken(r -> r.hostname(host).port(port).username(username));

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
  }

  @Override
  public void afterRestore(org.crac.Context<? extends Resource> context) {
    // Connections and secrets are re-established on demand.
  }

  /** Returns the class names of every JDBC driver found on the classpath. */
  static List<String> driverClassNames() {
    return DriverManager.drivers().map(Driver::getClass).map(Class::getName).sorted().toList();
  }
}
