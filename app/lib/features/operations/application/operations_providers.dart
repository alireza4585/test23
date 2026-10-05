import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/utils/day_key.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/daily_operations.dart';

/// Last 45 days of occupancy / revenue figures.
final operationsRangeProvider = StreamProvider<List<DailyOperations>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel) return Stream.value(const []);
  final allowed = user.canAny(const {
    AppPermission.financeView,
    AppPermission.operationsRecordDaily,
    AppPermission.energyView,
    AppPermission.dashboardOperations,
  });
  if (!allowed) return Stream.value(const []);
  final today = DayKey.startOfDay(ref.watch(clockProvider).now());
  return ref.watch(operationsRepositoryProvider).watchRange(
    user.hotelId,
    from: today.subtract(const Duration(days: 45)),
    to: today,
  );
});

class OperationsActions {
  OperationsActions(this.ref);

  final Ref ref;

  Future<void> save(DailyOperations figures) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.operationsRecordDaily)) {
      throw const PermissionDeniedFailure();
    }
    if (figures.roomsOccupied > figures.roomsAvailable) {
      throw const ValidationFailure('occupied_exceeds_available');
    }
    await ref
        .read(operationsRepositoryProvider)
        .save(user.hotelId, figures, user.asActor);
  }
}

final operationsActionsProvider = Provider<OperationsActions>(
  OperationsActions.new,
);
