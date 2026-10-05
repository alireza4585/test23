import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';
import '../../auth/domain/app_user.dart';
import 'room.dart';

/// Which room status transitions each role may perform.
///
/// Staff roles get a narrow, workflow-shaped set (a housekeeper can only move a
/// dirty room into cleaning and a cleaning room to clean). Roles holding
/// `rooms.manage` may set any status. The same table is enforced in
/// `firestore.rules` (`allowedRoomTransition`).
abstract final class RoomStatusPolicy {
  static const Map<AppRole, Map<RoomStatus, Set<RoomStatus>>> _byRole = {
    AppRole.housekeepingStaff: {
      RoomStatus.vacantDirty: {RoomStatus.cleaningInProgress},
      RoomStatus.cleaningInProgress: {RoomStatus.vacantClean},
    },
    AppRole.housekeepingManager: {
      RoomStatus.vacantDirty: {
        RoomStatus.cleaningInProgress,
        RoomStatus.vacantClean,
      },
      RoomStatus.cleaningInProgress: {
        RoomStatus.vacantClean,
        RoomStatus.vacantDirty,
      },
      RoomStatus.vacantClean: {RoomStatus.vacantDirty},
      RoomStatus.outOfOrder: {RoomStatus.vacantDirty},
    },
    AppRole.receptionStaff: {
      RoomStatus.vacantClean: {RoomStatus.occupied},
      RoomStatus.occupied: {RoomStatus.vacantDirty},
    },
    AppRole.maintenanceManager: {
      RoomStatus.vacantClean: {RoomStatus.outOfOrder},
      RoomStatus.vacantDirty: {RoomStatus.outOfOrder},
      RoomStatus.outOfOrder: {RoomStatus.vacantDirty},
    },
  };

  static Set<RoomStatus> allowedTargets(AppUser user, RoomStatus from) {
    if (user.can(AppPermission.roomsManage)) {
      return RoomStatus.values.where((s) => s != from).toSet();
    }
    if (!user.can(AppPermission.roomsUpdateStatus)) return const {};
    return _byRole[user.role]?[from] ?? const {};
  }

  static bool canTransition(AppUser user, RoomStatus from, RoomStatus to) =>
      allowedTargets(user, from).contains(to);
}
