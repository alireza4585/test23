import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/utils/day_key.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../operations/application/operations_providers.dart';
import '../domain/energy_analytics.dart';
import '../domain/energy_reading.dart';

/// Last 60 days of readings — enough for a 30-day window plus the previous
/// period used for comparison.
final energyReadingsProvider = StreamProvider<List<EnergyReading>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.energyView)) {
    return Stream.value(const []);
  }
  final today = DayKey.startOfDay(ref.watch(clockProvider).now());
  return ref.watch(energyRepositoryProvider).watchReadings(
    user.hotelId,
    from: today.subtract(const Duration(days: 60)),
    to: today,
  );
});

/// 30-day summary (up to yesterday) for one energy type.
final energySummaryProvider = Provider.family<EnergySummary?, EnergyType>((
  ref,
  type,
) {
  final readings = ref.watch(energyReadingsProvider).value;
  if (readings == null) return null;
  final settings = ref.watch(hotelSettingsProvider);
  final today = DayKey.startOfDay(ref.watch(clockProvider).now());
  return EnergyAnalytics.summarize(
    type: type,
    readings: readings,
    from: today.subtract(const Duration(days: 30)),
    to: today.subtract(const Duration(days: 1)),
    baseline: settings.energyDailyBaseline[type.name] ?? 0,
    alertThresholdPct: settings.energyAlertThresholdPct,
    tariff: settings.energyTariff[type.name],
    operations: ref.watch(operationsRangeProvider).value ?? const [],
  );
});

class EnergyActions {
  EnergyActions(this.ref);

  final Ref ref;

  Future<void> save(EnergyReadingDraft draft) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.energyRecord)) {
      throw const PermissionDeniedFailure();
    }
    if (draft.consumption < 0) {
      throw const ValidationFailure('negative_consumption');
    }
    await ref
        .read(energyRepositoryProvider)
        .saveReading(user.hotelId, draft, user.asActor);
  }
}

final energyActionsProvider = Provider<EnergyActions>(EnergyActions.new);
