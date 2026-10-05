import '../../../core/domain/actor.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';

enum UserStatus { active, suspended, disabled }

/// The authenticated principal.
///
/// [role] and [hotelIds] come from the backend's *verified* identity (Firebase
/// custom claims today, a JWT from the dedicated backend tomorrow). Profile
/// fields come from the `users/{uid}` document.
class AppUser {
  const AppUser({
    required this.uid,
    required this.nationalId,
    required this.fullName,
    required this.role,
    required this.hotelIds,
    required this.permissions,
    this.activeHotelId,
    this.staffId,
    this.phone,
    this.status = UserStatus.active,
    this.mustChangePassword = false,
  });

  final String uid;
  final String nationalId;
  final String fullName;
  final AppRole role;
  final List<String> hotelIds;
  final String? activeHotelId;
  final String? staffId;
  final String? phone;
  final UserStatus status;
  final bool mustChangePassword;

  /// Effective permissions (role template, possibly narrowed per hotel).
  final Set<AppPermission> permissions;

  /// Hotel whose data the user is currently working with.
  String get hotelId {
    final id = activeHotelId ?? (hotelIds.isEmpty ? null : hotelIds.first);
    if (id == null) {
      throw StateError('User $uid has no hotel assigned');
    }
    return id;
  }

  bool get hasHotel => activeHotelId != null || hotelIds.isNotEmpty;

  bool can(AppPermission permission) => permissions.contains(permission);

  bool canAny(Iterable<AppPermission> required) =>
      required.isEmpty || required.any(permissions.contains);

  Actor get asActor => Actor(uid: uid, name: fullName, role: role);

  String get firstName => fullName.split(' ').first;

  AppUser copyWith({
    String? activeHotelId,
    bool? mustChangePassword,
    Set<AppPermission>? permissions,
  }) {
    return AppUser(
      uid: uid,
      nationalId: nationalId,
      fullName: fullName,
      role: role,
      hotelIds: hotelIds,
      permissions: permissions ?? this.permissions,
      activeHotelId: activeHotelId ?? this.activeHotelId,
      staffId: staffId,
      phone: phone,
      status: status,
      mustChangePassword: mustChangePassword ?? this.mustChangePassword,
    );
  }
}
