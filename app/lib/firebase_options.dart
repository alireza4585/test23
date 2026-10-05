// Placeholder — replace by running `flutterfire configure` in `app/`.
//
// The generated file defines `DefaultFirebaseOptions.currentPlatform` for
// Android and iOS. Until then the app runs on the offline demo backend.
// (Keep the `isConfigured` getter when regenerating, or set it to true.)

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

abstract final class DefaultFirebaseOptions {
  /// `true` once real options are generated.
  static const bool isConfigured = false;

  static FirebaseOptions get currentPlatform {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError('Zarin Hooshmand targets Android and iOS.');
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'REPLACE_ME',
    appId: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    projectId: 'zarin-hooshmand-dev',
    storageBucket: 'zarin-hooshmand-dev.appspot.com',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'REPLACE_ME',
    appId: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    projectId: 'zarin-hooshmand-dev',
    storageBucket: 'zarin-hooshmand-dev.appspot.com',
    iosBundleId: 'com.zarinhooshmand.zarinHooshmand',
  );
}
