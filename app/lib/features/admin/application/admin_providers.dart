import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';
import '../../../core/security/role_policy.dart';
import '../../../core/utils/iran_national_id.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/domain/app_user.dart';
import '../domain/user_admin.dart';

final managedUsersProvider = StreamProvider<List<ManagedUser>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.usersManage)) {
    return Stream.value(const []);
  }
  return ref.watch(userAdminRepositoryProvider).watchUsers(user.hotelId);
});

/// Roles the signed-in user may assign (prevents privilege escalation; the
/// `adminCreateUser` function enforces the same table).
final assignableRolesProvider = Provider<List<AppRole>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null) return const [];
  return RolePolicy.assignableBy(user.role).toList()
    ..sort((a, b) => a.index.compareTo(b.index));
});

class UserAdminActions {
  UserAdminActions(this.ref);

  final Ref ref;

  static String generatePassword() {
    const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    final rng = Random.secure();
    final chars = [
      for (var i = 0; i < 6; i++) letters[rng.nextInt(letters.length)],
      for (var i = 0; i < 3; i++) digits[rng.nextInt(digits.length)],
    ]..shuffle(rng);
    return chars.join();
  }

  static bool isStrongPassword(String value) =>
      value.length >= 8 &&
      RegExp('[A-Za-z]').hasMatch(value) &&
      RegExp(r'\d').hasMatch(value);

  Future<String> create({
    required String nationalId,
    required String fullName,
    required AppRole role,
    required String temporaryPassword,
    String? phone,
  }) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!RolePolicy.assignableBy(user.role).contains(role)) {
      throw const PermissionDeniedFailure('role_not_assignable');
    }
    if (!IranNationalId.isValid(nationalId)) {
      throw const ValidationFailure('invalid_national_id');
    }
    return ref.read(userAdminRepositoryProvider).createUser(
      NewUserRequest(
        hotelId: user.hotelId,
        nationalId: IranNationalId.normalize(nationalId),
        fullName: fullName.trim(),
        role: role,
        temporaryPassword: temporaryPassword,
        phone: phone,
      ),
    );
  }

  Future<void> setStatus(ManagedUser target, UserStatus status) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    await ref
        .read(userAdminRepositoryProvider)
        .setStatus(hotelId: user.hotelId, uid: target.uid, status: status);
  }

  Future<String> resetPassword(ManagedUser target) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    final password = generatePassword();
    await ref.read(userAdminRepositoryProvider).resetPassword(
      hotelId: user.hotelId,
      uid: target.uid,
      temporaryPassword: password,
    );
    return password;
  }
}

final userAdminActionsProvider = Provider<UserAdminActions>(
  UserAdminActions.new,
);
