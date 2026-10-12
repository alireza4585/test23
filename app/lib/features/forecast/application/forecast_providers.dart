import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/forecast.dart';


final forecastsProvider = StreamProvider<Map<ForecastSeries, SeriesForecast>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null ||
      !user.hasHotel ||
      !user.canAny(const {AppPermission.dashboardExecutive, AppPermission.dashboardOperations})) {
    return Stream.value(const {});
  }
  return ref.watch(forecastRepositoryProvider).watchForecasts(user.hotelId);
});

class ForecastActions {
  ForecastActions(this.ref);

  final Ref ref;

  /// Same check as the server route (executives or hotel settings).
  bool get canRefresh =>
      ref.read(sessionUserProvider)?.canAny(const {AppPermission.dashboardExecutive, AppPermission.hotelSettings}) ?? false;

  Future<void> refresh() async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!canRefresh) throw const PermissionDeniedFailure('forecasts.run');
    await ref.read(forecastRepositoryProvider).refresh(user.hotelId);
  }
}

final forecastActionsProvider = Provider<ForecastActions>(ForecastActions.new);
