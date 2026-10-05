import '../../../core/security/app_role.dart';
import '../../auth/domain/app_user.dart';

class ManagedUser {
  const ManagedUser({
    required this.uid,
    required this.fullName,
    required this.nationalIdMasked,
    required this.role,
    required this.status,
    this.phone,
    this.lastLoginAt,
  });

  final String uid;
  final String fullName;
  final String nationalIdMasked;
  final AppRole role;
  final UserStatus status;
  final String? phone;
  final DateTime? lastLoginAt;
}

class NewUserRequest {
  const NewUserRequest({
    required this.hotelId,
    required this.nationalId,
    required this.fullName,
    required this.role,
    required this.temporaryPassword,
    this.phone,
  });

  final String hotelId;
  final String nationalId;
  final String fullName;
  final AppRole role;
  final String temporaryPassword;
  final String? phone;
}

/// User provisioning. Writes go through privileged backend endpoints
/// (Cloud Functions `adminCreateUser`, …) because creating credentials and
/// setting roles must never be possible from the client directly.
abstract interface class UserAdminRepository {
  Stream<List<ManagedUser>> watchUsers(String hotelId);

  Future<String> createUser(NewUserRequest request);

  Future<void> setStatus({
    required String hotelId,
    required String uid,
    required UserStatus status,
  });

  Future<void> resetPassword({
    required String hotelId,
    required String uid,
    required String temporaryPassword,
  });
}
