import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../core/error/app_failure.dart';
import '../../core/security/app_permission.dart';
import '../../core/security/app_role.dart';
import '../../core/security/role_policy.dart';
import '../../core/utils/iran_national_id.dart';
import '../../core/utils/stream_utils.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/auth/domain/auth_repository.dart';
import '../../features/auth/domain/user_session.dart';
import 'firestore_support.dart';

/// Firebase Authentication adapter.
///
/// Firebase Auth has no "national ID" provider, so each account is created
/// server-side (`adminCreateUser`) with a synthetic, non-routable e-mail
/// `<nationalId>@id.zarinhooshmand.app`. The mapping lives only here; the rest
/// of the app only ever sees national IDs. Brute-force protection, password
/// hashing and token rotation stay with Firebase.
///
/// Role and hotel membership are read from **custom claims** set by Cloud
/// Functions, the same values Firestore Security Rules authorise against.
class FirebaseAuthRepository implements AuthRepository {
  FirebaseAuthRepository(this._auth, this._firestore);

  static const emailDomain = 'id.zarinhooshmand.app';

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  static String emailFor(String nationalId) =>
      '${IranNationalId.normalize(nationalId)}@$emailDomain';

  @override
  Stream<AppUser?> watchCurrentUser() {
    return _auth.idTokenChanges().switchMap<AppUser?>((user) {
      if (user == null) return Stream<AppUser?>.value(null);
      return _firestore
          .doc(FsPaths.user(user.uid))
          .snapshots()
          .asyncMap((snapshot) async {
            final token = await user.getIdTokenResult();
            final appUser = await _toAppUser(
              user.uid,
              token.claims ?? const {},
              snapshot.data(),
            );
            if (appUser == null || appUser.status != UserStatus.active) {
              await _auth.signOut();
              return null;
            }
            return appUser;
          })
          .mapFailures();
    });
  }

  @override
  Future<AppUser> signIn({
    required String nationalId,
    required String password,
  }) {
    return guard(() async {
      final credential = await _auth.signInWithEmailAndPassword(
        email: emailFor(nationalId),
        password: password,
      );
      final user = credential.user!;
      // Force refresh so freshly assigned claims are picked up.
      final token = await user.getIdTokenResult(true);
      final profile = await _firestore.doc(FsPaths.user(user.uid)).get();
      final appUser = await _toAppUser(
        user.uid,
        token.claims ?? const {},
        profile.data(),
      );
      if (appUser == null) {
        await _auth.signOut();
        throw const AccountNotProvisionedFailure();
      }
      if (appUser.status != UserStatus.active) {
        await _auth.signOut();
        throw const AccountDisabledFailure();
      }
      return appUser;
    });
  }

  Future<AppUser?> _toAppUser(
    String uid,
    Map<String, dynamic> claims,
    Map<String, dynamic>? profile,
  ) async {
    final role = AppRole.fromCode(claims['role'] as String?);
    if (role == null || profile == null) return null;
    final hotelIds = (claims['hotelIds'] is List)
        ? (claims['hotelIds'] as List).whereType<String>().toList()
        : <String>[];
    if (hotelIds.isEmpty && role != AppRole.superAdmin) return null;

    final data = profile;
    final activeHotel = data.strOrNull('primaryHotelId') ??
        (hotelIds.isEmpty ? null : hotelIds.first);

    return AppUser(
      uid: uid,
      nationalId: data.str('nationalId'),
      fullName: data.str('fullName'),
      role: role,
      hotelIds: hotelIds,
      activeHotelId: activeHotel,
      staffId: data.strOrNull('staffId'),
      phone: data.strOrNull('phone'),
      status: data.enumValue('status', UserStatus.values, UserStatus.disabled),
      mustChangePassword: data.boolean('mustChangePassword'),
      permissions: await _permissionsFor(role, activeHotel),
    );
  }

  /// Role template, optionally narrowed by `hotels/{id}/roleOverrides/{role}`.
  Future<Set<AppPermission>> _permissionsFor(
    AppRole role,
    String? hotelId,
  ) async {
    if (hotelId == null) return RolePolicy.resolve(role);
    try {
      final override = await _firestore
          .doc('${FsPaths.roleOverrides(hotelId)}/${role.code}')
          .get();
      final codes = override.data()?.strings('permissions');
      if (codes == null) return RolePolicy.resolve(role);
      return RolePolicy.resolve(
        role,
        templateOverride: codes.map(AppPermission.fromCode).nonNulls.toSet(),
      );
    } on FirebaseException {
      // Overrides are optional — fall back to the default template.
      return RolePolicy.resolve(role);
    }
  }

  @override
  Future<void> signOut() => guard(_auth.signOut);

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) {
    return guard(() async {
      final user = _auth.currentUser;
      if (user == null || user.email == null) {
        throw const SessionExpiredFailure();
      }
      await user.reauthenticateWithCredential(
        EmailAuthProvider.credential(
          email: user.email!,
          password: currentPassword,
        ),
      );
      await user.updatePassword(newPassword);
      // Rules allow a user to flip only this flag (true → false) on their own
      // profile document.
      await _firestore.doc(FsPaths.user(user.uid)).update({
        'mustChangePassword': false,
        'passwordChangedAt': FieldValue.serverTimestamp(),
      });
    });
  }
}

class FirebaseSessionRepository implements SessionRepository {
  FirebaseSessionRepository(this._firestore, this._functions);

  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;

  /// Server-side so that `lastLoginAt` and the login audit entry cannot be
  /// forged by the client.
  @override
  Future<void> registerSession(AppUser user, DeviceDescriptor device) {
    return guard(() async {
      await _functions.httpsCallable('authRegisterSession').call<void>({
        'deviceId': device.deviceId,
        'platform': device.platform,
        'model': device.model,
        'osVersion': device.osVersion,
        'appVersion': device.appVersion,
        'pushToken': device.pushToken,
      });
    });
  }

  @override
  Future<void> endSession(AppUser user, String deviceId) {
    return guard(() async {
      await _firestore.doc('${FsPaths.sessions(user.uid)}/$deviceId').set({
        'revokedAt': FieldValue.serverTimestamp(),
        'pushToken': null,
      }, SetOptions(merge: true));
    });
  }

  @override
  Stream<List<UserSession>> watchSessions(String uid) => _firestore
      .collection(FsPaths.sessions(uid))
      .orderBy('lastSeenAt', descending: true)
      .limit(20)
      .snapshots()
      .map(
        (s) => [
          for (final d in s.docs)
            UserSession(
              id: d.id,
              platform: d.data().str('platform'),
              model: d.data().str('model'),
              appVersion: d.data().str('appVersion'),
              createdAt: d.data().dateOrNow('createdAt'),
              lastSeenAt: d.data().dateOrNow('lastSeenAt'),
              revokedAt: d.data().date('revokedAt'),
            ),
        ],
      )
      .mapFailures();

  @override
  Future<void> revokeAllSessions(String uid) => guard(() async {
    await _functions.httpsCallable('authRevokeSessions').call<void>({
      'uid': uid,
    });
  });
}
