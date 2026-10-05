// Placeholder for Firebase project `zarin-hoshmand`. Regenerate in `app/`:
//
//   dart pub global activate flutterfire_cli
//   flutterfire configure --project=zarin-hoshmand --platforms=android,ios
//
// The generated file replaces this one as-is. Until then `bootstrap.dart`
// sees the REPLACE_ME values and runs the offline demo backend.
// ignore_for_file: type=lint

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'REPLACE_ME',
    appId: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    projectId: 'zarin-hoshmand',
    storageBucket: 'zarin-hoshmand.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'REPLACE_ME',
    appId: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    projectId: 'zarin-hoshmand',
    storageBucket: 'zarin-hoshmand.firebasestorage.app',
    iosBundleId: 'com.zarinhooshmand.zarinHooshmand',
  );
}
