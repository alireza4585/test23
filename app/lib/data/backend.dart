import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:pocketbase/pocketbase.dart';

import '../core/platform/platform_services.dart';
import 'demo/demo_store.dart';

/// The concrete backend the repositories are bound to.
///
/// This is the single seam between the app and infrastructure: each feature's
/// repository provider switches on [Backend] and returns the matching
/// implementation. Adding the dedicated backend means adding a
/// `RestBackend(apiClient)` case and one implementation per repository — the
/// domain and presentation layers stay untouched.
sealed class Backend {
  const Backend();
}

final class FirebaseBackend extends Backend {
  const FirebaseBackend({
    required this.auth,
    required this.firestore,
    required this.storage,
    required this.functions,
  });

  final FirebaseAuth auth;
  final FirebaseFirestore firestore;
  final FirebaseStorage storage;
  final FirebaseFunctions functions;
}

/// Self-hosted PocketBase (see `pocketbase/`). The auth token lives in
/// [secureStore] (Keychain / Keystore) via the client's auth store.
final class PocketBaseBackend extends Backend {
  const PocketBaseBackend({required this.client, required this.secureStore});

  final PocketBase client;
  final SecureStore secureStore;
}

final class DemoBackend extends Backend {
  const DemoBackend(this.store);

  final DemoStore store;
}
