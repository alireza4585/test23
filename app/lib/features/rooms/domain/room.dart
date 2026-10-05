import '../../../core/domain/actor.dart';

enum RoomStatus {
  /// آماده — clean, inspected, sellable.
  vacantClean,

  /// نیاز به نظافت — guest checked out, waiting for housekeeping.
  vacantDirty,

  /// در حال نظافت
  cleaningInProgress,

  /// اشغال
  occupied,

  /// خارج از سرویس / تعمیر
  outOfOrder;

  static RoomStatus fromCode(String? code) => RoomStatus.values.firstWhere(
    (s) => s.name == code,
    orElse: () => RoomStatus.vacantDirty,
  );

  bool get isSellable => this == RoomStatus.vacantClean;
}

enum RoomType { single, double, twin, suite, deluxe }

class Room {
  const Room({
    required this.id,
    required this.number,
    required this.floor,
    required this.type,
    required this.status,
    this.updatedAt,
    this.updatedByName,
    this.note,
  });

  final String id;
  final String number;
  final int floor;
  final RoomType type;
  final RoomStatus status;
  final DateTime? updatedAt;
  final String? updatedByName;
  final String? note;

  Room copyWith({
    RoomStatus? status,
    DateTime? updatedAt,
    String? updatedByName,
    String? note,
  }) {
    return Room(
      id: id,
      number: number,
      floor: floor,
      type: type,
      status: status ?? this.status,
      updatedAt: updatedAt ?? this.updatedAt,
      updatedByName: updatedByName ?? this.updatedByName,
      note: note ?? this.note,
    );
  }
}

/// A room status change that must be applied atomically together with another
/// write (e.g. completing a housekeeping task flips the room to clean).
class RoomStatusChange {
  const RoomStatusChange({
    required this.roomId,
    required this.from,
    required this.to,
  });

  final String roomId;
  final RoomStatus from;
  final RoomStatus to;
}

abstract interface class RoomsRepository {
  Stream<List<Room>> watchRooms(String hotelId);

  Stream<Room?> watchRoom(String hotelId, String roomId);

  Future<void> updateStatus({
    required String hotelId,
    required RoomStatusChange change,
    required Actor actor,
    String? note,
  });
}
