import java.util.Base64

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Demo build (offline demo backend, installs next to the real app):
//   flutter build apk --android-project-arg=zhDemo=true --dart-define=ZH_BACKEND=demo
// A Gradle property instead of a product flavor: with flavors every
// production build would need --flavor (and a default flavor also applies to
// the iOS schemes). Without the property nothing changes.
val zhDemo = project.findProperty("zhDemo")?.toString() == "true"
if (zhDemo) {
    // Flutter passes --dart-define values base64-encoded in "dart-defines".
    val defines = (project.findProperty("dart-defines") as String?).orEmpty()
        .split(",").filter { it.isNotBlank() }
        .map { String(Base64.getDecoder().decode(it)) }
    val backend = defines.firstOrNull { it.startsWith("ZH_BACKEND=") }?.substringAfter("=") ?: "demo"
    require(backend == "demo") { "zhDemo=true builds the demo app only: use --dart-define=ZH_BACKEND=demo (got $backend)" }
}

android {
    namespace = "com.zarinhooshmand.zarin_hooshmand"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.zarinhooshmand.zarin_hooshmand"
        // Android 10 (API 29) is the minimum supported version.
        minSdk = 29
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        if (zhDemo) {
            applicationIdSuffix = ".demo"
            versionNameSuffix = "-demo"
        }
        manifestPlaceholders["appLabel"] = if (zhDemo) "زرین (نسخهٔ نمایشی)" else "زرین هوشمند"
    }

    buildTypes {
        release {
            // Replace with the production keystore (see docs/10-roadmap.md →
            // release checklist). Debug keys keep `flutter run --release` working.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
