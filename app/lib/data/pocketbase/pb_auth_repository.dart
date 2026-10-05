import 'dart:async';

import 'package:pocketbase/pocketbase.dart';

import '../../core/error/app_failure.dart';
import '../../core/platform/platform_services.dart';
import '../../core/security/app_permission.dart';
import '../../core/security/app_role.dart';
import '../../core/utils/iran_national_id.dart';
import '../../features/admin/domain/user_admin.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/auth/domain/auth_repository.dart';
import '../../features/auth/domain/user_session.dart';
import 'pb_support.dart';

/// Secure-storage keys for the PocketBase session (Keychain / Keystore).
abstract final class PbAuthKeys {
  static const auth = 'zh.pb.auth';
  static const identity = 'zh.pb.identity';
}

/// PocketBase authentication: national ID is the `users` identity field.
///
/// Role, permissions and hotel membership come from `GET /api/zarin/me`,
/// computed by the server from the same data its API rules enforce.
class PocketBaseAuthRepository implements AuthRepository {
  PocketBaseAuthRepository(this._pb, this._secureStore);

  final PocketBase _pb;
  final SecureStore _secureStore;

  @override
  Stream<AppUser?> watchCurrentUser() {
    late final StreamController<AppUser?> controller;
    StreamSubscription<AuthStoreEvent>? authChanges;
    UnsubscribeFunc? profileSub;
    String? watchedUid;
    var closed = false;

    Future<void> unwatchProfile() async {
      final u = profileSub;
      profileSub = null;
      watchedUid = null;
      if (u != null) await u().catchError((_) {});
    }

    Future<void> emit() async {
      if (!_pb.authStore.isValid) {
        await unwatchProfile();
        if (!closed) controller.add(null);
        return;
      }
      try {
        final user = await _profile();
        if (user.status != UserStatus.active) {
          _pb.authStore.clear();
          return; // the auth change re-emits null
        }
        if (!closed) controller.add(user);
        if (watchedUid != user.uid) {
          await unwatchProfile();
          watchedUid = user.uid;
          // Role / status changes made by an admin apply immediately.
          profileSub = await _pb.collection('users').subscribe(user.uid, (_) => unawaited(emit()));
        }
      } on ClientException catch (e) {
        if (e.statusCode == 401 || e.statusCode == 403) {
          _pb.authStore.clear(); // revoked or suspended
        } else if (!closed) {
          controller.addError(mapPbError(e));
        }
      } catch (e) {
        if (!closed) controller.addError(mapPbError(e));
      }
    }

    controller = StreamController<AppUser?>(
      onListen: () {
        authChanges = _pb.authStore.onChange.listen((_) => unawaited(emit()));
        unawaited(emit());
      },
      onCancel: () async {
        closed = true;
        await authChanges?.cancel();
        await unwatchProfile();
      },
    );
    return controller.stream;
  }

  @override
  Future<AppUser> signIn({required String nationalId, required String password}) async {
    final identity = IranNationalId.normalize(nationalId);
    try {
      await _pb.collection('users').authWithPassword(identity, password);
    } on ClientException catch (e) {
      throw switch (e.statusCode) {
        400 => const InvalidCredentialsFailure(),
        403 => const AccountDisabledFailure(),
        _ => mapPbError(e),
      };
    }
    await _secureStore.write(PbAuthKeys.identity, identity);
    final user = await pbGuard(_profile);
    if (user.status != UserStatus.active) {
      _pb.authStore.clear();
      throw const AccountDisabledFailure();
    }
    return user;
  }

  Future<AppUser> _profile() async {
    final me = await _pb.send<Map<String, dynamic>>('/api/zarin/me');
    final role = AppRole.fromCode(me['role'] as String?);
    if (role == null) throw const AccountNotProvisionedFailure();
    final hotels = (me['hotels'] as List? ?? const []).whereType<String>().toList();
    final primary = me['primaryHotel'] as String?;
    if (hotels.isEmpty && (primary == null || primary.isEmpty)) {
      throw const AccountNotProvisionedFailure();
    }
    final identity = await _secureStore.read(PbAuthKeys.identity);
    final masked = me['nationalIdMasked'] as String? ?? '';
    final staffId = me['staffId'] as String? ?? '';
    return AppUser(
      uid: me['id'] as String,
      // The full ID never leaves the server; the one typed at sign-in is
      // kept on-device (secure storage) for re-authentication.
      nationalId: identity != null && IranNationalId.mask(identity) == masked ? identity : masked,
      fullName: me['fullName'] as String? ?? '',
      role: role,
      hotelIds: hotels.isEmpty ? [primary!] : hotels,
      activeHotelId: (primary == null || primary.isEmpty) ? null : primary,
      staffId: staffId.isEmpty ? null : staffId,
      status: UserStatus.values.firstWhere((s) => s.name == me['status'], orElse: () => UserStatus.disabled),
      mustChangePassword: me['mustChangePassword'] == true,
      permissions: (me['permissions'] as List? ?? const [])
          .whereType<String>()
          .map(AppPermission.fromCode)
          .nonNulls
          .toSet(),
    );
  }

  @override
  Future<void> signOut() async {
    _pb.authStore.clear();
  }

  @override
  Future<void> changePassword({required String currentPassword, required String newPassword}) {
    return pbGuard(() async {
      final record = _pb.authStore.record;
      final identity = await _secureStore.read(PbAuthKeys.identity);
      if (record == null || identity == null) throw const SessionExpiredFailure();
      try {
        await _pb.collection('users').update(record.id, body: {
          'oldPassword': currentPassword,
          'password': newPassword,
          'passwordConfirm': newPassword,
        });
      } on ClientException catch (e) {
        if (e.statusCode == 400 && pbErrorCode(e) == null) {
          // PocketBase rejects a wrong `oldPassword` as a field error.
          throw const InvalidCredentialsFailure('old_password');
        }
        rethrow;
      }
      // A password change invalidates every token, including this one.
      await _pb.collection('users').authWithPassword(identity, newPassword);
    });
  }
}

class PocketBaseSessionRepository implements SessionRepository {
  PocketBaseSessionRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Future<void> registerSession(AppUser user, DeviceDescriptor device) => pbGuard(() async {
    await _pb.send<dynamic>('/api/zarin/sessions', method: 'POST', body: {
      'deviceId': device.deviceId,
      'platform': device.platform,
      'model': device.model,
      'osVersion': device.osVersion,
      'appVersion': device.appVersion,
      'pushToken': device.pushToken,
    });
  });

  @override
  Future<void> endSession(AppUser user, String deviceId) => pbGuard(() async {
    final found = await _pb.collection('sessions').getList(
      perPage: 1,
      filter: _pb.filter('user = {:u} && deviceId = {:d}', {'u': user.uid, 'd': deviceId}),
    );
    for (final s in found.items) {
      await _pb.collection('sessions').update(s.id, body: {'revokedAt': pbDate(DateTime.now()), 'pushToken': ''});
    }
  });

  @override
  Stream<List<UserSession>> watchSessions(String uid) => _live
      .list('sessions', filter: _pb.filter('user = {:u}', {'u': uid}), sort: '-lastSeenAt', limit: 20)
      .map(
        (records) => [
          for (final r in records)
            UserSession(
              id: r.str('deviceId'),
              platform: r.str('platform'),
              model: r.str('model'),
              appVersion: r.str('appVersion'),
              createdAt: r.createdAt,
              lastSeenAt: r.dateOrNow('lastSeenAt'),
              revokedAt: r.date('revokedAt'),
            ),
        ],
      );

  @override
  Future<void> revokeAllSessions(String uid) => pbGuard(() async {
    await _pb.send<dynamic>('/api/zarin/sessions/revoke', method: 'POST', body: {'uid': uid});
  });
}

class PocketBaseUserAdminRepository implements UserAdminRepository {
  PocketBaseUserAdminRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  /// The `users` list rule only returns colleagues of a shared hotel to roles
  /// with `users.manage`; national IDs are a hidden field (masked copy only).
  @override
  Stream<List<ManagedUser>> watchUsers(String hotelId) => _live
      .list('users', filter: _pb.filter('hotels.id ?= {:h}', {'h': hotelId}), limit: 500)
      .map(
        (records) => [
          for (final r in records)
            ManagedUser(
              uid: r.id,
              fullName: r.str('fullName'),
              nationalIdMasked: r.str('nationalIdMasked'),
              role: AppRole.fromCode(r.strOrNull('role')) ?? AppRole.receptionStaff,
              status: r.enumValue('status', UserStatus.values, UserStatus.active),
              phone: r.strOrNull('phone'),
            ),
        ]..sort((a, b) => a.role.index.compareTo(b.role.index)),
      );

  @override
  Future<String> createUser(NewUserRequest request) => pbGuard(() async {
    final result = await _pb.send<Map<String, dynamic>>('/api/zarin/users', method: 'POST', body: {
      'hotelId': request.hotelId,
      'nationalId': request.nationalId,
      'fullName': request.fullName,
      'phone': request.phone,
      'role': request.role.code,
      'temporaryPassword': request.temporaryPassword,
    });
    return result['uid'] as String;
  });

  @override
  Future<void> setStatus({required String hotelId, required String uid, required UserStatus status}) =>
      pbGuard(() async {
        await _pb.send<dynamic>('/api/zarin/users/$uid/status', method: 'POST', body: {
          'hotelId': hotelId,
          'status': status.name,
        });
      });

  @override
  Future<void> resetPassword({required String hotelId, required String uid, required String temporaryPassword}) =>
      pbGuard(() async {
        await _pb.send<dynamic>('/api/zarin/users/$uid/password', method: 'POST', body: {
          'hotelId': hotelId,
          'temporaryPassword': temporaryPassword,
        });
      });
}
