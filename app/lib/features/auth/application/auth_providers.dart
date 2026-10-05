import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/platform/platform_providers.dart';
import '../../../data/repository_providers.dart';
import '../domain/app_user.dart';
import '../domain/user_session.dart';

/// The signed-in user (or null). Drives routing, navigation and every
/// permission check in the UI.
final currentUserProvider = StreamProvider<AppUser?>(
  (ref) => ref.watch(authRepositoryProvider).watchCurrentUser(),
);

/// Convenience accessor for screens rendered behind the auth guard.
final sessionUserProvider = Provider<AppUser?>(
  (ref) => ref.watch(currentUserProvider).value,
);

/// Hotel id of the signed-in user (null while signed out).
final activeHotelIdProvider = Provider<String?>((ref) {
  final user = ref.watch(sessionUserProvider);
  return user != null && user.hasHotel ? user.hotelId : null;
});

/// Set when the idle timer signs the user out, so the login screen can say why.
class SignOutReasonNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? reason) => state = reason;
}

final signOutReasonProvider = NotifierProvider<SignOutReasonNotifier, String?>(
  SignOutReasonNotifier.new,
);

/// Login form submission state.
class LoginController extends Notifier<AsyncValue<void>> {
  @override
  AsyncValue<void> build() => const AsyncData(null);

  Future<bool> signIn(String nationalId, String password) async {
    state = const AsyncLoading();
    try {
      final user = await ref
          .read(authRepositoryProvider)
          .signIn(nationalId: nationalId, password: password);
      ref.read(signOutReasonProvider.notifier).set(null);
      unawaited(_registerDevice(user));
      state = const AsyncData(null);
      return true;
    } catch (e, st) {
      state = AsyncError(e, st);
      return false;
    }
  }

  Future<void> _registerDevice(AppUser user) async {
    try {
      final device = await ref.read(deviceInfoServiceProvider).describe();
      await ref.read(sessionRepositoryProvider).registerSession(user, device);
    } catch (_) {
      // Session registration is best-effort; it must never block sign-in.
    }
  }
}

final loginControllerProvider =
    NotifierProvider<LoginController, AsyncValue<void>>(LoginController.new);

/// Sign-out, including ending the device session (push token removal).
class SessionController {
  SessionController(this.ref);

  final Ref ref;

  Future<void> signOut({String? reason}) async {
    final user = ref.read(sessionUserProvider);
    if (user != null) {
      try {
        final deviceId = await ref.read(deviceInfoServiceProvider).deviceId();
        await ref.read(sessionRepositoryProvider).endSession(user, deviceId);
      } catch (_) {
        // Best-effort.
      }
    }
    ref.read(signOutReasonProvider.notifier).set(reason);
    await ref.read(authRepositoryProvider).signOut();
  }
}

final sessionControllerProvider = Provider<SessionController>(
  SessionController.new,
);

final mySessionsProvider = StreamProvider<List<UserSession>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null) return const Stream.empty();
  return ref.watch(sessionRepositoryProvider).watchSessions(user.uid);
});
