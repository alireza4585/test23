import '../../features/auth/domain/app_user.dart';
import '../security/app_permission.dart';

/// Every location in the app. Paths are also used as deep links from push
/// notifications and alerts (`route` field), so they are part of the public
/// contract between backend and app.
abstract final class Routes {
  static const splash = '/splash';
  static const login = '/login';
  static const changePassword = '/change-password';
  static const accessDenied = '/access-denied';

  static const home = '/home';
  static const rooms = '/rooms';
  static String room(String id) => '/rooms/$id';
  static const housekeeping = '/housekeeping';
  static const housekeepingNew = '/housekeeping/new';
  static String task(String id) => '/housekeeping/tasks/$id';
  static const maintenance = '/maintenance';
  static const maintenanceNew = '/maintenance/new';
  static String ticket(String id) => '/maintenance/$id';
  static const energy = '/energy';
  static const inventory = '/inventory';
  static const inventoryNew = '/inventory/new';
  static String item(String id) => '/inventory/$id';
  static const staff = '/staff';
  static const dailyOps = '/operations/daily';
  static const reports = '/reports';
  static const notifications = '/notifications';
  static const insights = '/insights';
  static const assistant = '/assistant';
  static const users = '/admin/users';
  static const usersNew = '/admin/users/new';
  static const profile = '/profile';

  static const public = {splash, login};
}

/// Route-level authorization (first matching prefix wins, so more specific
/// prefixes come first). This only decides what the UI *shows*; the backend
/// independently rejects any request the role is not entitled to.
abstract final class RouteAccess {
  static const _rules = <(String, Set<AppPermission>)>[
    (Routes.housekeepingNew, {AppPermission.housekeepingAssign}),
    (
      Routes.housekeeping,
      {AppPermission.housekeepingViewOwn, AppPermission.housekeepingViewAll},
    ),
    (Routes.rooms, {AppPermission.roomsView}),
    (Routes.maintenanceNew, {AppPermission.maintenanceReport}),
    (
      Routes.maintenance,
      {AppPermission.maintenanceViewOwn, AppPermission.maintenanceViewAll},
    ),
    (Routes.energy, {AppPermission.energyView}),
    (Routes.inventoryNew, {AppPermission.inventoryManage}),
    (Routes.inventory, {AppPermission.inventoryView}),
    (Routes.staff, {AppPermission.staffView, AppPermission.staffViewOwnShifts}),
    (Routes.dailyOps, {AppPermission.operationsRecordDaily}),
    (Routes.reports, {AppPermission.reportsView}),
    (Routes.notifications, {AppPermission.notificationsView}),
    (Routes.insights, {AppPermission.aiInsightsView}),
    (Routes.assistant, {AppPermission.aiAssistantUse}),
    (Routes.users, {AppPermission.usersManage}),
  ];

  static Set<AppPermission> requiredFor(String location) {
    for (final (prefix, permissions) in _rules) {
      if (location == prefix || location.startsWith('$prefix/')) {
        return permissions;
      }
    }
    return const {};
  }

  static bool canAccess(AppUser user, String location) =>
      user.canAny(requiredFor(location));
}
