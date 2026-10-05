import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/config/app_config.dart';
import 'core/di/core_providers.dart';
import 'core/platform/firebase_push_service.dart';
import 'core/platform/platform_providers.dart';
import 'core/platform/platform_services.dart';
import 'core/preferences/preferences.dart';
import 'data/backend.dart';
import 'data/demo/demo_store.dart';
import 'firebase_options.dart';

/// Composition root. Resolves configuration, initialises the selected backend
/// and platform services, and hands everything to Riverpod as overrides.
/// This is the only place that knows which concrete implementations run.
Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();
  var config = AppConfig.fromEnvironment();
  await initializeDateFormatting('fa');
  await initializeDateFormatting('en');
  final prefs = await SharedPreferences.getInstance();

  final overrides = <Override>[
    sharedPreferencesProvider.overrideWithValue(prefs),
    secureStoreProvider.overrideWithValue(FlutterSecureStore()),
  ];

  Backend backend;
  if (config.backend == BackendKind.firebase && DefaultFirebaseOptions.isConfigured) {
    backend = await _initFirebase(config);
    overrides.add(
      pushServiceProvider.overrideWithValue(FirebasePushService(FirebaseMessaging.instance)),
    );
  } else {
    if (config.backend == BackendKind.firebase) {
      debugPrint(
        'ZH: Firebase requested but lib/firebase_options.dart is not configured '
        '(run `flutterfire configure`). Falling back to the demo backend.',
      );
      config = config.copyWith(backend: BackendKind.demo);
    }
    backend = DemoBackend(DemoStore.seeded());
  }

  overrides.addAll([
    appConfigProvider.overrideWithValue(config),
    backendProvider.overrideWithValue(backend),
  ]);

  runApp(ProviderScope(overrides: overrides, child: const ZarinApp()));
}

Future<FirebaseBackend> _initFirebase(AppConfig config) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  final auth = FirebaseAuth.instance;
  final firestore = FirebaseFirestore.instance;
  final storage = FirebaseStorage.instance;
  final functions = FirebaseFunctions.instanceFor(region: config.functionsRegion);

  // Offline cache: staff keep working through Wi-Fi dead zones; writes sync
  // when connectivity returns (transactions still require a connection).
  firestore.settings = const Settings(persistenceEnabled: true);

  if (config.useEmulators && !kReleaseMode) {
    final host = config.emulatorHost;
    await auth.useAuthEmulator(host, 9099);
    firestore.useFirestoreEmulator(host, 8080);
    await storage.useStorageEmulator(host, 9199);
    functions.useFunctionsEmulator(host, 5001);
  }
  return FirebaseBackend(
    auth: auth,
    firestore: firestore,
    storage: storage,
    functions: functions,
  );
}
