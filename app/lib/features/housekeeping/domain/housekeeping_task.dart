import '../../../core/domain/actor.dart';
import '../../rooms/domain/room.dart';

enum HousekeepingTaskType {
  checkoutClean,
  stayoverClean,
  deepClean,
  inspection,
  turndown;

  /// Task types that take the room out of the sellable pool while running.
  bool get affectsRoomStatus =>
      this == checkoutClean || this == deepClean || this == inspection;
}

enum TaskStatus { pending, inProgress, done, cancelled }

enum TaskPriority { low, normal, high, urgent }

class HousekeepingTask {
  const HousekeepingTask({
    required this.id,
    required this.roomId,
    required this.roomNumber,
    required this.type,
    required this.status,
    required this.priority,
    required this.createdAt,
    this.assigneeId,
    this.assigneeName,
    this.dueAt,
    this.startedAt,
    this.completedAt,
    this.notes,
    this.createdByName,
  });

  final String id;
  final String roomId;
  final String roomNumber;
  final HousekeepingTaskType type;
  final TaskStatus status;
  final TaskPriority priority;
  final DateTime createdAt;
  final String? assigneeId;
  final String? assigneeName;
  final DateTime? dueAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final String? notes;
  final String? createdByName;

  bool get isOpen => status == TaskStatus.pending || status == TaskStatus.inProgress;

  Duration? get duration {
    if (startedAt == null || completedAt == null) return null;
    return completedAt!.difference(startedAt!);
  }

  bool isOverdue(DateTime now) =>
      isOpen && dueAt != null && now.isAfter(dueAt!);

  HousekeepingTask copyWith({
    TaskStatus? status,
    DateTime? startedAt,
    DateTime? completedAt,
    String? notes,
    String? assigneeId,
    String? assigneeName,
  }) {
    return HousekeepingTask(
      id: id,
      roomId: roomId,
      roomNumber: roomNumber,
      type: type,
      status: status ?? this.status,
      priority: priority,
      createdAt: createdAt,
      assigneeId: assigneeId ?? this.assigneeId,
      assigneeName: assigneeName ?? this.assigneeName,
      dueAt: dueAt,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
      notes: notes ?? this.notes,
      createdByName: createdByName,
    );
  }
}

class HousekeepingTaskDraft {
  const HousekeepingTaskDraft({
    required this.roomId,
    required this.roomNumber,
    required this.type,
    required this.priority,
    this.assigneeId,
    this.assigneeName,
    this.dueAt,
    this.notes,
  });

  final String roomId;
  final String roomNumber;
  final HousekeepingTaskType type;
  final TaskPriority priority;
  final String? assigneeId;
  final String? assigneeName;
  final DateTime? dueAt;
  final String? notes;
}

abstract interface class HousekeepingRepository {
  /// Tasks for [day]. When [assigneeId] is given only that person's tasks are
  /// returned (required for staff — enforced by security rules too).
  Stream<List<HousekeepingTask>> watchTasks(
    String hotelId, {
    required DateTime day,
    String? assigneeId,
  });

  Stream<HousekeepingTask?> watchTask(String hotelId, String taskId);

  Future<String> createTask(
    String hotelId,
    HousekeepingTaskDraft draft,
    Actor actor,
  );

  /// Moves the task to [status] and, when given, applies [roomChange] in the
  /// same atomic write.
  Future<void> transition(
    String hotelId, {
    required HousekeepingTask task,
    required TaskStatus status,
    required Actor actor,
    RoomStatusChange? roomChange,
    String? notes,
  });
}
