import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/utils/day_key.dart';
import '../../energy/application/energy_providers.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../housekeeping/application/housekeeping_providers.dart';
import '../../inventory/application/inventory_providers.dart';
import '../../maintenance/application/maintenance_providers.dart';
import '../../operations/application/operations_providers.dart';
import '../../rooms/application/rooms_providers.dart';
import '../../staff/application/staff_providers.dart';
import '../domain/dashboard_metrics.dart';

/// Live dashboard metrics. Recomputes whenever any underlying stream emits;
/// sources the user cannot access simply contribute empty data (their
/// providers return empty streams), so one provider serves every role.
final dashboardMetricsProvider = Provider<AsyncValue<DashboardMetrics>>((ref) {
  final rooms = ref.watch(roomsProvider);
  if (rooms.hasError) return AsyncError(rooms.error!, rooms.stackTrace!);
  if (!rooms.hasValue) return const AsyncLoading();

  final now = ref.watch(clockProvider).now();
  final today = DayKey.startOfDay(now);
  return AsyncData(
    DashboardMetrics.compute(
      now: now,
      settings: ref.watch(hotelSettingsProvider),
      rooms: rooms.requireValue,
      operations: ref.watch(operationsRangeProvider).value ?? const [],
      energy: ref.watch(energyReadingsProvider).value ?? const [],
      tickets: ref.watch(ticketsProvider((mine: false, activeOnly: true))).value ?? const [],
      tasks: ref.watch(todayTasksProvider(false)).value ?? const [],
      shifts: ref.watch(shiftsProvider((day: today, mine: false))).value ?? const [],
      inventory: ref.watch(inventoryItemsProvider).value ?? const [],
    ),
  );
});
