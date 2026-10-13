import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/security/role_policy.dart';
import '../../../core/utils/day_key.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../briefing/domain/briefing.dart';
import '../../energy/domain/energy_model.dart';
import '../../energy/domain/energy_reading.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../hotel/domain/hotel.dart';
import '../domain/ai_action.dart';

/// Action Center actions the user may see (recommendationLoop flag).
final actionsProvider = StreamProvider<List<AiAction>>((ref) {
  final user = ref.watch(sessionUserProvider);
  final on = ref.watch(hotelSettingsProvider).has(HotelFeature.recommendationLoop);
  if (!on || user == null || !user.hasHotel || !user.can(AppPermission.aiInsightsView)) return Stream.value(const []);
  return ref.watch(actionsRepositoryProvider).watchActions(user.hotelId);
});

/// What the signed-in user may do in the Action Center. Mirrors the server
/// (ai.actions.approve, own department, the type's permission); the server
/// checks again on every decision.
class ActionCenter {
  ActionCenter(this.ref);

  final Ref ref;

  bool canDecide(AiAction a) {
    final user = ref.read(sessionUserProvider);
    if (user == null || !a.isPending || !user.can(AppPermission.aiActionsApprove)) return false;
    if (!RolePolicy.canDecideDepartment(user.role, a.department.name)) return false;
    return switch (a.type) {
      ActionType.createTicket => user.can(AppPermission.maintenanceReport),
      ActionType.createTask => user.can(AppPermission.housekeepingAssign),
      ActionType.notifyRole => true,
      ActionType.adjustBaseline => RolePolicy.baselineAdjustRoles.contains(user.role),
    };
  }

  bool get canAdjustBaseline {
    final user = ref.read(sessionUserProvider);
    return user != null && user.can(AppPermission.aiActionsApprove) && RolePolicy.baselineAdjustRoles.contains(user.role);
  }

  Future<void> decide(AiAction a, {required bool approve, String note = ''}) {
    if (!canDecide(a)) throw const PermissionDeniedFailure('ai.actions.approve');
    if (!approve && note.trim().length < 3) throw const ValidationFailure('note_required');
    return ref.read(actionsRepositoryProvider).decide(a.id, approve: approve, note: note.trim());
  }

  Future<void> proposeBaselineAdjustment(EnergyType type, List<DateTime> days, String reason) {
    final user = ref.read(sessionUserProvider);
    if (user == null || !canAdjustBaseline) throw const PermissionDeniedFailure('baseline_adjust_not_allowed');
    if (reason.trim().length < 10) throw const ValidationFailure('reason_required');
    return ref.read(actionsRepositoryProvider).proposeBaselineAdjustment(
      user.hotelId,
      meterType: type.name,
      days: [for (final d in days) DayKey.of(d)]..sort(),
      reason: reason.trim(),
    );
  }
}

final actionCenterProvider = Provider<ActionCenter>(ActionCenter.new);

/// Today's morning briefing for the user's role (morningBriefing flag).
final briefingProvider = StreamProvider<Briefing?>((ref) {
  final user = ref.watch(sessionUserProvider);
  final on = ref.watch(hotelSettingsProvider).has(HotelFeature.morningBriefing);
  if (!on || user == null || !user.hasHotel || !user.can(AppPermission.aiInsightsView)) return Stream.value(null);
  final day = DayKey.of(DayKey.hotelToday(ref.read(clockProvider).now()));
  return ref.watch(briefingRepositoryProvider).watchToday(user.hotelId, day);
});

/// The stored energy model of one meter (energyBaseline flag).
final energyModelProvider = StreamProvider.family<EnergyModelView?, EnergyType>((ref, type) {
  final user = ref.watch(sessionUserProvider);
  final on = ref.watch(hotelSettingsProvider).has(HotelFeature.energyBaseline);
  if (!on || user == null || !user.hasHotel || !user.can(AppPermission.energyView)) return Stream.value(null);
  return ref.watch(energyModelRepositoryProvider).watchModel(user.hotelId, type);
});
