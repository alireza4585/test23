import 'app_user.dart';
import 'user_session.dart';

/// Authentication contract. Implementations: Firebase Auth (MVP), in-memory
/// demo, and later the dedicated backend (OAuth2/JWT).
///
/// Every implementation must:
/// * identify users by **national ID + password**;
/// * resolve the role from a server-verified source (never from user input);
/// * throw [AppFailure] subtypes instead of vendor exceptions.
abstract interface class AuthRepository {
  /// Emits the signed-in user, or `null` when signed out. Re-emits when the
  /// role/claims or profile change (e.g. an admin suspends the account).
  Stream<AppUser?> watchCurrentUser();

  Future<AppUser> signIn({
    required String nationalId,
    required String password,
  });

  Future<void> signOut();

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  });
}

/// Device sessions — used for "active devices" in the profile screen,
/// push-token registration and remote sign-out.
abstract interface class SessionRepository {
  Future<void> registerSession(AppUser user, DeviceDescriptor device);

  Future<void> endSession(AppUser user, String deviceId);

  Stream<List<UserSession>> watchSessions(String uid);

  /// Revokes refresh tokens on all devices (server-side).
  Future<void> revokeAllSessions(String uid);
}
