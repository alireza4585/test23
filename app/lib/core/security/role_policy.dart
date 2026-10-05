import 'app_permission.dart';
import 'app_role.dart';

/// Default role → permission matrix ("role templates").
///
/// Mirrors `firebase/functions/src/domain/rbac.ts` and the role checks in
/// `firebase/firestore.rules`. A hotel can later customise templates through
/// the `roleTemplates` collection; [RolePolicy.resolve] merges such overrides
/// but can only *narrow* what a role sees — the server remains authoritative.
abstract final class RolePolicy {
  static const Set<AppPermission> _all = {...AppPermission.values};

  static const Set<AppPermission> _staffCommon = {
    AppPermission.maintenanceReport,
    AppPermission.maintenanceViewOwn,
    AppPermission.staffViewOwnShifts,
    AppPermission.notificationsView,
  };

  static const Map<AppRole, Set<AppPermission>> defaults = {
    AppRole.superAdmin: _all,
    AppRole.hotelOwner: {
      AppPermission.dashboardExecutive,
      AppPermission.roomsView,
      AppPermission.housekeepingViewAll,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewAll,
      AppPermission.energyView,
      AppPermission.inventoryView,
      AppPermission.staffView,
      AppPermission.financeView,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
      AppPermission.aiAssistantUse,
      AppPermission.usersManage,
      AppPermission.auditView,
      AppPermission.hotelSettings,
    },
    AppRole.generalManager: {
      AppPermission.dashboardExecutive,
      AppPermission.dashboardOperations,
      AppPermission.roomsView,
      AppPermission.roomsUpdateStatus,
      AppPermission.roomsManage,
      AppPermission.housekeepingViewAll,
      AppPermission.housekeepingAssign,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewAll,
      AppPermission.maintenanceManage,
      AppPermission.energyView,
      AppPermission.energyRecord,
      AppPermission.inventoryView,
      AppPermission.inventoryMove,
      AppPermission.inventoryManage,
      AppPermission.staffView,
      AppPermission.staffManage,
      AppPermission.operationsRecordDaily,
      AppPermission.financeView,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
      AppPermission.aiAssistantUse,
      AppPermission.usersManage,
      AppPermission.auditView,
      AppPermission.hotelSettings,
    },
    AppRole.operationsManager: {
      AppPermission.dashboardOperations,
      AppPermission.roomsView,
      AppPermission.roomsUpdateStatus,
      AppPermission.roomsManage,
      AppPermission.housekeepingViewAll,
      AppPermission.housekeepingAssign,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewAll,
      AppPermission.maintenanceManage,
      AppPermission.energyView,
      AppPermission.inventoryView,
      AppPermission.staffView,
      AppPermission.staffManage,
      AppPermission.operationsRecordDaily,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
      AppPermission.aiAssistantUse,
    },
    AppRole.energyManager: {
      AppPermission.dashboardOperations,
      AppPermission.roomsView,
      AppPermission.energyView,
      AppPermission.energyRecord,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewAll,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
      AppPermission.aiAssistantUse,
    },
    AppRole.maintenanceManager: {
      AppPermission.dashboardOperations,
      AppPermission.roomsView,
      AppPermission.roomsUpdateStatus,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewAll,
      AppPermission.maintenanceManage,
      AppPermission.maintenanceWork,
      AppPermission.energyView,
      AppPermission.inventoryView,
      AppPermission.inventoryMove,
      AppPermission.staffView,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
    },
    AppRole.housekeepingManager: {
      AppPermission.dashboardOperations,
      AppPermission.roomsView,
      AppPermission.roomsUpdateStatus,
      AppPermission.housekeepingViewAll,
      AppPermission.housekeepingAssign,
      AppPermission.housekeepingComplete,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewOwn,
      AppPermission.inventoryView,
      AppPermission.inventoryMove,
      AppPermission.staffView,
      AppPermission.reportsView,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
    },
    AppRole.restaurantManager: {
      AppPermission.dashboardOperations,
      AppPermission.inventoryView,
      AppPermission.inventoryMove,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewOwn,
      AppPermission.staffView,
      AppPermission.reportsView,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
    },
    AppRole.inventoryManager: {
      AppPermission.dashboardOperations,
      AppPermission.inventoryView,
      AppPermission.inventoryMove,
      AppPermission.inventoryManage,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewOwn,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
    },
    AppRole.hrManager: {
      AppPermission.dashboardOperations,
      AppPermission.staffView,
      AppPermission.staffManage,
      AppPermission.usersManage,
      AppPermission.maintenanceReport,
      AppPermission.maintenanceViewOwn,
      AppPermission.reportsView,
      AppPermission.notificationsView,
    },
    AppRole.receptionStaff: {
      ..._staffCommon,
      AppPermission.roomsView,
      AppPermission.roomsUpdateStatus,
      AppPermission.operationsRecordDaily,
    },
    AppRole.housekeepingStaff: {
      ..._staffCommon,
      AppPermission.roomsView,
      AppPermission.roomsUpdateStatus,
      AppPermission.housekeepingViewOwn,
      AppPermission.housekeepingComplete,
    },
    AppRole.maintenanceStaff: {
      ..._staffCommon,
      AppPermission.roomsView,
      AppPermission.maintenanceWork,
    },
    AppRole.restaurantStaff: {..._staffCommon, AppPermission.inventoryView},
    AppRole.analyst: {
      AppPermission.dashboardExecutive,
      AppPermission.roomsView,
      AppPermission.housekeepingViewAll,
      AppPermission.maintenanceViewAll,
      AppPermission.energyView,
      AppPermission.inventoryView,
      AppPermission.staffView,
      AppPermission.financeView,
      AppPermission.reportsView,
      AppPermission.reportsGenerate,
      AppPermission.notificationsView,
      AppPermission.aiInsightsView,
      AppPermission.aiAssistantUse,
    },
  };

  /// Roles each role may create / assign through user management.
  /// Prevents privilege escalation (e.g. HR cannot mint a General Manager).
  static const Map<AppRole, Set<AppRole>> assignableRoles = {
    AppRole.superAdmin: {...AppRole.values},
    AppRole.hotelOwner: {
      AppRole.generalManager,
      AppRole.operationsManager,
      AppRole.energyManager,
      AppRole.maintenanceManager,
      AppRole.housekeepingManager,
      AppRole.restaurantManager,
      AppRole.inventoryManager,
      AppRole.hrManager,
      AppRole.receptionStaff,
      AppRole.housekeepingStaff,
      AppRole.maintenanceStaff,
      AppRole.restaurantStaff,
      AppRole.analyst,
    },
    AppRole.generalManager: {
      AppRole.operationsManager,
      AppRole.energyManager,
      AppRole.maintenanceManager,
      AppRole.housekeepingManager,
      AppRole.restaurantManager,
      AppRole.inventoryManager,
      AppRole.hrManager,
      AppRole.receptionStaff,
      AppRole.housekeepingStaff,
      AppRole.maintenanceStaff,
      AppRole.restaurantStaff,
      AppRole.analyst,
    },
    AppRole.hrManager: {
      AppRole.receptionStaff,
      AppRole.housekeepingStaff,
      AppRole.maintenanceStaff,
      AppRole.restaurantStaff,
    },
  };

  /// Effective permissions for [role]. When a hotel-level [templateOverride]
  /// is present it is intersected with the defaults (narrowing only).
  static Set<AppPermission> resolve(
    AppRole role, {
    Set<AppPermission>? templateOverride,
  }) {
    final base = defaults[role] ?? const <AppPermission>{};
    if (templateOverride == null) return base;
    return base.intersection(templateOverride);
  }

  static Set<AppRole> assignableBy(AppRole role) =>
      assignableRoles[role] ?? const <AppRole>{};
}
