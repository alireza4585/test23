import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/utils/clock.dart';
import '../../auth/domain/app_user.dart';
import '../../rooms/domain/room.dart';
import 'housekeeping_task.dart';

/// Use case: start / complete housekeeping work.
///
/// Encapsulates the business rules so that every UI (staff mobile flow,
/// manager board, future tablet kiosk) behaves identically:
/// * only the assignee — or a manager — may work a task;
/// * starting a checkout/deep clean marks the room "cleaning in progress";
/// * completing it marks the room "vacant clean" (sellable again).
class HousekeepingWorkflow {
  const HousekeepingWorkflow(this._repository, {this.clock = const Clock()});

  final HousekeepingRepository _repository;
  final Clock clock;

  Future<void> start({
    required String hotelId,
    required HousekeepingTask task,
    required AppUser user,
    required RoomStatus currentRoomStatus,
  }) {
    _ensureCanWork(task, user);
    if (task.status != TaskStatus.pending) {
      throw const ValidationFailure('task_not_pending');
    }
    final roomChange =
        task.type.affectsRoomStatus &&
            currentRoomStatus == RoomStatus.vacantDirty
        ? RoomStatusChange(
            roomId: task.roomId,
            from: currentRoomStatus,
            to: RoomStatus.cleaningInProgress,
          )
        : null;
    return _repository.transition(
      hotelId,
      task: task.copyWith(startedAt: clock.now()),
      status: TaskStatus.inProgress,
      actor: user.asActor,
      roomChange: roomChange,
    );
  }

  Future<void> complete({
    required String hotelId,
    required HousekeepingTask task,
    required AppUser user,
    required RoomStatus currentRoomStatus,
    String? notes,
  }) {
    _ensureCanWork(task, user);
    if (task.status != TaskStatus.inProgress) {
      throw const ValidationFailure('task_not_in_progress');
    }
    // Only rooms we put into "cleaning" are released; this keeps the change
    // within the transitions housekeepers are allowed by security rules.
    final roomChange =
        task.type.affectsRoomStatus &&
            currentRoomStatus == RoomStatus.cleaningInProgress
        ? RoomStatusChange(
            roomId: task.roomId,
            from: currentRoomStatus,
            to: RoomStatus.vacantClean,
          )
        : null;
    return _repository.transition(
      hotelId,
      task: task.copyWith(completedAt: clock.now()),
      status: TaskStatus.done,
      actor: user.asActor,
      roomChange: roomChange,
      notes: notes,
    );
  }

  void _ensureCanWork(HousekeepingTask task, AppUser user) {
    final isAssignee = task.assigneeId == user.uid;
    final isManager = user.can(AppPermission.housekeepingAssign);
    if (!(isManager || (isAssignee && user.can(AppPermission.housekeepingComplete)))) {
      throw const PermissionDeniedFailure('not_task_assignee');
    }
  }
}
