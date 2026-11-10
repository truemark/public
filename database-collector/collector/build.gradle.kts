plugins {
    java
    id("com.diffplug.spotless") version "8.11.0"
}

group = "io.truemark"

repositories {
    mavenCentral()
}

java {
    toolchain {
        // Must match the Lambda runtime set in ../cdk/src/collector-function.ts
        languageVersion = JavaLanguageVersion.of(25)
    }
}

configurations.runtimeClasspath {
    // The URL connection HTTP client is used instead; leaving these out keeps the package small.
    exclude(group = "software.amazon.awssdk", module = "apache-client")
    exclude(group = "software.amazon.awssdk", module = "apache5-client")
    exclude(group = "software.amazon.awssdk", module = "netty-nio-client")
}

dependencies {
    implementation("com.amazonaws:aws-lambda-java-core:1.4.1")
    implementation("org.crac:crac:1.5.0")

    implementation(platform("software.amazon.awssdk:bom:2.57.12"))
    implementation("software.amazon.awssdk:secretsmanager")
    // Only used to sign IAM database authentication tokens, which makes no API call.
    implementation("software.amazon.awssdk:rds")
    implementation("software.amazon.awssdk:url-connection-client")

    implementation(platform("com.fasterxml.jackson:jackson-bom:2.23.0"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml")

    // JDBC drivers. Every driver listed here is packaged into the function
    // under lib/ and discovered at runtime through java.sql.DriverManager.
    runtimeOnly("org.postgresql:postgresql:42.7.14")
    // Used for both MySQL and MariaDB targets.
    runtimeOnly("org.mariadb.jdbc:mariadb-java-client:3.5.11")
    runtimeOnly("com.oracle.database.jdbc:ojdbc17:23.26.4.0.0")
    runtimeOnly("com.microsoft.sqlserver:mssql-jdbc:13.6.2.jre11")

    testImplementation(platform("org.junit:junit-bom:6.1.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("com.h2database:h2:2.5.252")
    testImplementation(platform("org.testcontainers:testcontainers-bom:2.0.5"))
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testRuntimeOnly("org.slf4j:slf4j-simple:2.0.17")
}

spotless {
    java {
        googleJavaFormat()
    }
}

tasks.test {
    useJUnitPlatform()
    // Lets HandlerTest build the AWS clients; nothing is ever sent with these credentials.
    environment("AWS_REGION", "us-east-1")
    environment("AWS_ACCESS_KEY_ID", "test")
    environment("AWS_SECRET_ACCESS_KEY", "test")
    testLogging {
        events("skipped", "failed")
        showStandardStreams = false
    }
}

// Byte-for-byte reproducible archives keep the CDK asset hash stable, so the
// function is only redeployed when its contents change.
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

// Lambda deployment package: classes and resources at the root, dependency
// jars under lib/. Jars are left intact (not shaded) so signed drivers and
// their META-INF/services/java.sql.Driver registrations keep working.
val buildZip by tasks.registering(Zip::class) {
    archiveFileName = "collector.zip"
    destinationDirectory = layout.buildDirectory.dir("distributions")
    from(sourceSets.main.get().output)
    into("lib") {
        from(configurations.runtimeClasspath)
    }
}

tasks.assemble {
    dependsOn(buildZip)
}
