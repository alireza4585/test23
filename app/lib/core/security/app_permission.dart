/// Fine-grained capabilities. Roles are bundles of permissions
/// (see `role_policy.dart`).
///
/// The wire value ([code]) is identical in the Flutter app, Cloud Functions
/// (`firebase/functions/src/domain/rbac.ts`) and the `permissions` Firestore
/// catalog. Firestore Security Rules enforce the same matrix server-side, so
/// the client checks here only shape the UI — they are never the last line of
/// defence.
enum AppPermission {
  // Dashboards
  dashboardExecutive('dashboard.executive'),
  dashboardOperations('dashboard.operations'),

  // Rooms
  roomsView('rooms.view'),
  roomsUpdateStatus('rooms.updateStatus'),
  roomsManage('rooms.manage'),

  // Housekeeping
  housekeepingViewOwn('housekeeping.viewOwn'),
  housekeepingViewAll('housekeeping.viewAll'),
  housekeepingAssign('housekeeping.assign'),
  housekeepingComplete('housekeeping.complete'),

  // Maintenance
  maintenanceReport('maintenance.report'),
  maintenanceViewOwn('maintenance.viewOwn'),
  maintenanceViewAll('maintenance.viewAll'),
  maintenanceManage('maintenance.manage'),
  maintenanceWork('maintenance.work'),

  // Energy
  energyView('energy.view'),
  energyRecord('energy.record'),

  // Inventory
  inventoryView('inventory.view'),
  inventoryMove('inventory.move'),
  inventoryManage('inventory.manage'),

  // Staff & shifts
  staffViewOwnShifts('staff.viewOwnShifts'),
  staffView('staff.view'),
  staffManage('staff.manage'),

  // Operations & finance
  operationsRecordDaily('operations.recordDaily'),
  financeView('finance.view'),

  // Reports
  reportsView('reports.view'),
  reportsGenerate('reports.generate'),

  // Notifications & AI
  notificationsView('notifications.view'),
  aiInsightsView('ai.insights.view'),
  aiAssistantUse('ai.assistant.use'),

  // Administration
  usersManage('users.manage'),
  auditView('audit.view'),
  hotelSettings('hotel.settings');

  const AppPermission(this.code);

  final String code;

  static AppPermission? fromCode(String code) {
    for (final p in values) {
      if (p.code == code) return p;
    }
    return null;
  }
}
