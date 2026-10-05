import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../rooms/domain/room.dart';
import '../domain/housekeeping_task.dart';
import '../domain/housekeeping_workflow.dart';

/// Today's tasks. Users without `housekeeping.viewAll` (or when [mineOnly])
/// get only their own — which is also the only query the security rules
/// permit for them.
final todayTasksProvider =
    StreamProvider.family<List<HousekeepingTask>, bool>((ref, mineOnly) {
      final user = ref.watch(sessionUserProvider);
      if (user == null ||
          !user.hasHotel ||
          !user.canAny(const {
            AppPermission.housekeepingViewOwn,
            AppPermission.housekeepingViewAll,
          })) {
        return Stream.value(const []);
      }
      final canSeeAll = user.can(AppPermission.housekeepingViewAll);
      return ref.watch(housekeepingRepositoryProvider).watchTasks(
        user.hotelId,
        day: ref.watch(clockProvider).now(),
        assigneeId: (mineOnly || !canSeeAll) ? user.uid : null,
      );
    });

final taskProvider =
    StreamProvider.autoDispose.family<HousekeepingTask?, String>((ref, id) {
      final hotelId = ref.watch(activeHotelIdProvider);
      if (hotelId == null) return Stream.value(null);
      return ref.watch(housekeepingRepositoryProvider).watchTask(hotelId, id);
    });

final housekeepingWorkflowProvider = Provider<HousekeepingWorkflow>(
  (ref) => HousekeepingWorkflow(
    ref.watch(housekeepingRepositoryProvider),
    clock: ref.watch(clockProvider),
  ),
);

class HousekeepingActions {
  HousekeepingActions(this.ref);

  final Ref ref;

  Future<void> start(HousekeepingTask task) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    final room = await _room(task.roomId);
    await ref.read(housekeepingWorkflowProvider).start(
      hotelId: user.hotelId,
      task: task,
      user: user,
      currentRoomStatus: room.status,
    );
  }

  Future<void> complete(HousekeepingTask task, {String? notes}) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    final room = await _room(task.roomId);
    await ref.read(housekeepingWorkflowProvider).complete(
      hotelId: user.hotelId,
      task: task,
      user: user,
      currentRoomStatus: room.status,
      notes: notes,
    );
  }

  /// One-shot read straight from the repository. (Riverpod 3 pauses
  /// providers nobody listens to, so `ref.read(provider.future)` is not a
  /// reliable way to fetch fresh data from an action.)
  Future<Room> _room(String roomId) async {
    final hotelId = ref.read(activeHotelIdProvider);
    if (hotelId == null) throw const SessionExpiredFailure();
    final room = await ref
        .read(roomsRepositoryProvider)
        .watchRoom(hotelId, roomId)
        .first;
    if (room == null) throw const NotFoundFailure('room');
    return room;
  }

  Future<String> create(HousekeepingTaskDraft draft) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.housekeepingAssign)) {
      throw const PermissionDeniedFailure();
    }
    return ref
        .read(housekeepingRepositoryProvider)
        .createTask(user.hotelId, draft, user.asActor);
  }
}

final housekeepingActionsProvider = Provider<HousekeepingActions>(
  HousekeepingActions.new,
);
