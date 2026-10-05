import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/staff.dart';

/// Staff roster. Only roles with `staff.view` (or that assign work) can list
/// colleagues; for others this stays empty.
final staffListProvider = StreamProvider<List<StaffMember>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel) return Stream.value(const []);
  final allowed = user.canAny(const {
    AppPermission.staffView,
    AppPermission.housekeepingAssign,
    AppPermission.maintenanceManage,
  });
  if (!allowed) return Stream.value(const []);
  return ref.watch(staffRepositoryProvider).watchStaff(user.hotelId);
});

typedef ShiftQuery = ({DateTime day, bool mine});

final shiftsProvider =
    StreamProvider.family<List<Shift>, ShiftQuery>((ref, query) {
      final user = ref.watch(sessionUserProvider);
      if (user == null ||
          !user.hasHotel ||
          !user.canAny(const {
            AppPermission.staffView,
            AppPermission.staffViewOwnShifts,
          })) {
        return Stream.value(const []);
      }
      final canSeeAll = user.can(AppPermission.staffView);
      return ref.watch(staffRepositoryProvider).watchShifts(
        user.hotelId,
        day: query.day,
        userId: (query.mine || !canSeeAll) ? user.uid : null,
      );
    });

class StaffActions {
  StaffActions(this.ref);

  final Ref ref;

  Future<void> addShift(ShiftDraft draft) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.staffManage)) {
      throw const PermissionDeniedFailure();
    }
    await ref
        .read(staffRepositoryProvider)
        .createShift(user.hotelId, draft, user.asActor);
  }

  Future<void> setStatus(Shift shift, ShiftStatus status) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    await ref.read(staffRepositoryProvider).updateShiftStatus(
      user.hotelId,
      shiftId: shift.id,
      status: status,
      actor: user.asActor,
    );
  }
}

final staffActionsProvider = Provider<StaffActions>(StaffActions.new);
