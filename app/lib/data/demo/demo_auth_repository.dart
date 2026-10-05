import 'dart:async';

import '../../core/error/app_failure.dart';
import '../../core/security/role_policy.dart';
import '../../core/utils/iran_national_id.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/auth/domain/auth_repository.dart';
import '../../features/auth/domain/user_session.dart';
import 'demo_collection.dart';
import 'demo_store.dart';

class DemoAuthRepository implements AuthRepository {
  DemoAuthRepository(this._store);

  final DemoStore _store;

  AppUser? _userFor(String? uid) {
    if (uid == null) return null;
    final account = _store.accountByUid(uid);
    if (account == null || account.status != UserStatus.active) return null;
    return toAppUser(account);
  }

  static AppUser toAppUser(DemoAccount account) => AppUser(
    uid: account.uid,
    nationalId: account.nationalId,
    fullName: account.fullName,
    role: account.role,
    hotelIds: account.hotelIds,
    activeHotelId: account.hotelIds.isEmpty ? null : account.hotelIds.first,
    staffId: account.staffId,
    phone: account.phone,
    status: account.status,
    permissions: RolePolicy.resolve(account.role),
  );

  @override
  Stream<AppUser?> watchCurrentUser() {
    // Subscribe synchronously on listen so no auth change can slip between
    // the initial value and the subscription.
    StreamSubscription<String?>? subscription;
    late final StreamController<AppUser?> controller;
    controller = StreamController<AppUser?>(
      onListen: () {
        controller.add(_userFor(_store.signedInUid));
        subscription = _store.authChanges.stream.listen(
          (uid) => controller.add(_userFor(uid)),
        );
      },
      onCancel: () {
        unawaited(subscription?.cancel());
      },
    );
    return controller.stream;
  }

  @override
  Future<AppUser> signIn({
    required String nationalId,
    required String password,
  }) async {
    await _store.latency();
    final normalized = IranNationalId.normalize(nationalId);
    final account = _store.accountsByNationalId[normalized];
    if (account == null || account.password != password) {
      throw const InvalidCredentialsFailure();
    }
    if (account.status != UserStatus.active) {
      throw const AccountDisabledFailure();
    }
    account.lastLoginAt = _store.clock.now();
    _store.signedInUid = account.uid;
    _store.audit(account.fullName, 'login', 'users/${account.uid}');
    _store.authChanges.add(account.uid);
    return toAppUser(account);
  }

  @override
  Future<void> signOut() async {
    final uid = _store.signedInUid;
    if (uid != null) {
      _store.audit(_store.accountByUid(uid)?.fullName ?? uid, 'logout', 'users/$uid');
    }
    _store.signedInUid = null;
    _store.authChanges.add(null);
  }

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _store.latency();
    final account = _store.accountByUid(_store.signedInUid ?? '');
    if (account == null) throw const SessionExpiredFailure();
    if (account.password != currentPassword) {
      throw const InvalidCredentialsFailure();
    }
    account.password = newPassword;
  }
}

class DemoSessionRepository implements SessionRepository {
  DemoSessionRepository(this._store);

  final DemoStore _store;

  @override
  Future<void> registerSession(AppUser user, DeviceDescriptor device) async {
    final id = '${user.uid}-${device.deviceId}';
    final existing = _store.sessions.get(id);
    final now = _store.clock.now();
    _store.sessions.put(
      Scoped(
        user.uid,
        id,
        UserSession(
          id: device.deviceId,
          platform: device.platform,
          model: device.model,
          appVersion: device.appVersion,
          createdAt: existing?.value.createdAt ?? now,
          lastSeenAt: now,
        ),
      ),
    );
  }

  @override
  Future<void> endSession(AppUser user, String deviceId) async {
    final id = '${user.uid}-$deviceId';
    final existing = _store.sessions.get(id);
    if (existing == null) return;
    final s = existing.value;
    _store.sessions.put(
      Scoped(
        user.uid,
        id,
        UserSession(
          id: s.id,
          platform: s.platform,
          model: s.model,
          appVersion: s.appVersion,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          revokedAt: _store.clock.now(),
        ),
      ),
    );
  }

  @override
  Stream<List<UserSession>> watchSessions(String uid) => _store.sessions
      .watch(
        where: (s) => s.scope == uid,
        sort: (a, b) => b.value.lastSeenAt.compareTo(a.value.lastSeenAt),
      )
      .map((list) => [for (final s in list) s.value]);

  @override
  Future<void> revokeAllSessions(String uid) async {
    await _store.latency();
    for (final s in _store.sessions.all.where((s) => s.scope == uid).toList()) {
      final v = s.value;
      if (v.revokedAt != null) continue;
      _store.sessions.put(
        Scoped(
          uid,
          s.id,
          UserSession(
            id: v.id,
            platform: v.platform,
            model: v.model,
            appVersion: v.appVersion,
            createdAt: v.createdAt,
            lastSeenAt: v.lastSeenAt,
            revokedAt: _store.clock.now(),
          ),
        ),
      );
    }
  }
}
