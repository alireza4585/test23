import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';

import 'platform_services.dart';

/// FCM implementation of [PushService]. Messages are sent by the
/// `dispatchNotification` Cloud Function with a `route` data field used for
/// deep-linking when the user taps the notification.
class FirebasePushService implements PushService {
  FirebasePushService(this._messaging);

  final FirebaseMessaging _messaging;

  @override
  Future<void> requestPermission() async {
    await _messaging.requestPermission();
  }

  @override
  Future<String?> token() async {
    try {
      return await _messaging.getToken();
    } catch (_) {
      // No Play Services / APNs not configured — push is optional.
      return null;
    }
  }

  @override
  Stream<String> get tokenRefresh => _messaging.onTokenRefresh;

  @override
  Stream<String> get openedRoutes async* {
    final initial = await _messaging.getInitialMessage();
    final initialRoute = initial?.data['route'];
    if (initialRoute is String) yield initialRoute;
    yield* FirebaseMessaging.onMessageOpenedApp
        .map((m) => m.data['route'])
        .where((r) => r is String)
        .cast<String>();
  }
}
