import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/room.dart';
import '../domain/room_status_policy.dart';

final roomsProvider = StreamProvider<List<Room>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.roomsView)) {
    return Stream.value(const []);
  }
  return ref.watch(roomsRepositoryProvider).watchRooms(user.hotelId);
});

final roomProvider = StreamProvider.autoDispose.family<Room?, String>((ref, id) {
  final hotelId = ref.watch(activeHotelIdProvider);
  if (hotelId == null) return Stream.value(null);
  return ref.watch(roomsRepositoryProvider).watchRoom(hotelId, id);
});

/// Room counts per status (drives dashboard bars and filters).
final roomStatusCountsProvider = Provider<Map<RoomStatus, int>>((ref) {
  final rooms = ref.watch(roomsProvider).value ?? const [];
  return {
    for (final s in RoomStatus.values) s: rooms.where((r) => r.status == s).length,
  };
});

class RoomsActions {
  RoomsActions(this.ref);

  final Ref ref;

  Future<void> changeStatus(Room room, RoomStatus to, {String? note}) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!RoomStatusPolicy.canTransition(user, room.status, to)) {
      throw const PermissionDeniedFailure('room_transition');
    }
    await ref.read(roomsRepositoryProvider).updateStatus(
      hotelId: user.hotelId,
      change: RoomStatusChange(roomId: room.id, from: room.status, to: to),
      actor: user.asActor,
      note: note,
    );
  }
}

final roomsActionsProvider = Provider<RoomsActions>(RoomsActions.new);
