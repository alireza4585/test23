/// Which backend implementation the app wires its repositories to.
///
/// * [pocketbase] – self-hosted PocketBase server (`pocketbase/` in the repo):
///   schema, API rules and hooks; can run in-country. Needs `ZH_PB_URL`.
/// * [firebase] – managed Firebase backend (Auth, Firestore, Storage, Functions).
/// * [demo] – fully offline in-memory backend with seeded hotel data. Used for
///   sales demos, UI development and widget tests. It exercises exactly the
///   same domain + presentation code as the Firebase backend, which is how we
///   keep the app independent from any single backend vendor.
/// * A future `rest` kind (dedicated server + PostgreSQL) only needs a new set
///   of repository implementations — no UI or domain changes.
enum BackendKind { pocketbase, firebase, demo }

/// Immutable runtime configuration, resolved once at startup from
/// `--dart-define` values.
///
/// ```sh
/// flutter run --dart-define=ZH_BACKEND=pocketbase --dart-define=ZH_PB_URL=https://api.example.ir
/// ```
class AppConfig {
  const AppConfig({
    required this.backend,
    required this.environment,
    this.pocketBaseUrl = '',
    this.functionsRegion = 'europe-west3',
    this.useEmulators = false,
    this.emulatorHost = 'localhost',
    this.sessionTimeout = const Duration(minutes: 30),
    this.enableAiAssistant = true,
  });

  factory AppConfig.fromEnvironment() {
    const backendName = String.fromEnvironment(
      'ZH_BACKEND',
      defaultValue: 'demo',
    );
    const env = String.fromEnvironment('ZH_ENV', defaultValue: 'dev');
    const pbUrl = String.fromEnvironment('ZH_PB_URL');
    const region = String.fromEnvironment(
      'ZH_FUNCTIONS_REGION',
      defaultValue: 'europe-west3',
    );
    const useEmulators = bool.fromEnvironment('ZH_USE_EMULATORS');
    const emulatorHost = String.fromEnvironment(
      'ZH_EMULATOR_HOST',
      defaultValue: 'localhost',
    );
    const timeoutMinutes = int.fromEnvironment(
      'ZH_SESSION_TIMEOUT_MINUTES',
      defaultValue: 30,
    );
    const enableAi = bool.fromEnvironment(
      'ZH_ENABLE_AI_ASSISTANT',
      defaultValue: true,
    );

    return AppConfig(
      backend: BackendKind.values.firstWhere(
        (b) => b.name == backendName,
        orElse: () => BackendKind.demo,
      ),
      environment: env,
      pocketBaseUrl: pbUrl,
      functionsRegion: region,
      useEmulators: useEmulators,
      emulatorHost: emulatorHost,
      sessionTimeout: const Duration(minutes: timeoutMinutes),
      enableAiAssistant: enableAi,
    );
  }

  final BackendKind backend;

  /// `dev`, `staging` or `prod`.
  final String environment;

  /// Base URL of the PocketBase server (e.g. `https://api.example.ir`).
  final String pocketBaseUrl;

  /// Region where Cloud Functions are deployed.
  final String functionsRegion;

  /// Connect Firebase SDKs to the local emulator suite.
  final bool useEmulators;
  final String emulatorHost;

  /// Idle time after which the user is signed out. Hotels often share devices
  /// between shift workers, so this is enforced on the client in addition to
  /// server-side token revocation.
  final Duration sessionTimeout;

  final bool enableAiAssistant;

  bool get isDemo => backend == BackendKind.demo;
  bool get isProduction => environment == 'prod';

  AppConfig copyWith({BackendKind? backend, Duration? sessionTimeout}) {
    return AppConfig(
      backend: backend ?? this.backend,
      environment: environment,
      pocketBaseUrl: pocketBaseUrl,
      functionsRegion: functionsRegion,
      useEmulators: useEmulators,
      emulatorHost: emulatorHost,
      sessionTimeout: sessionTimeout ?? this.sessionTimeout,
      enableAiAssistant: enableAiAssistant,
    );
  }
}
