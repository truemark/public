plugins {
    // Lets Gradle download the JDK named by the toolchain in build.gradle.kts
    // when it is not already installed.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "database-collector"
