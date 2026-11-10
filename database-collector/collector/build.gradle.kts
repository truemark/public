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

dependencies {
    implementation("com.amazonaws:aws-lambda-java-core:1.4.1")
    implementation("org.crac:crac:1.5.0")

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
}

spotless {
    java {
        googleJavaFormat()
    }
}

tasks.test {
    useJUnitPlatform()
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
