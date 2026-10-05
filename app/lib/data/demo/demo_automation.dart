import '../../core/security/app_role.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/notifications/domain/notification_models.dart';
import 'demo_collection.dart';
import 'demo_store.dart';

/// Simulates what Cloud Functions triggers + n8n do in production
/// (`functions/src/triggers/*`): raising alerts and fanning notifications out
/// to the right roles. Keeping this in the demo backend means the demo shows
/// the full "data → analysis → alert → decision" loop offline.
class DemoAutomation {
  DemoAutomation(this.store);

  final DemoStore store;

  static const _energyAudience = {
    AppRole.generalManager,
    AppRole.hotelOwner,
    AppRole.operationsManager,
    AppRole.energyManager,
  };

  void onEnergyReading(EnergyReading reading) {
    final hotel = store.hotels.all.first;
    final baseline = hotel.settings.energyDailyBaseline[reading.type.name] ?? 0;
    final threshold = hotel.settings.energyAlertThresholdPct;
    if (baseline <= 0) return;
    final deviation = (reading.consumption - baseline) / baseline * 100;
    if (deviation <= threshold) return;
    final title = 'مصرف ${_energyLabel(reading.type)} بالاتر از خط مبنا';
    final message =
        '${reading.consumption.toStringAsFixed(0)} ${reading.type.unit} '
        '(${deviation.toStringAsFixed(0)}٪ بیش از خط مبنا)';
    _raise(
      AlertType.energySpike,
      deviation > threshold * 2 ? AlertSeverity.critical : AlertSeverity.warning,
      title,
      message,
      '/energy',
      _energyAudience,
    );
  }

  void onTicketCreated(MaintenanceTicket ticket) {
    final critical = ticket.priority == TicketPriority.critical ||
        ticket.priority == TicketPriority.high;
    if (critical) {
      _raise(
        AlertType.criticalTicket,
        ticket.priority == TicketPriority.critical
            ? AlertSeverity.critical
            : AlertSeverity.warning,
        'خرابی جدید: ${ticket.title}',
        'محل: ${ticket.locationLabel}',
        '/maintenance/${ticket.id}',
        {AppRole.generalManager, AppRole.maintenanceManager, AppRole.operationsManager},
      );
    } else {
      notifyRoles(
        {AppRole.maintenanceManager},
        title: 'خرابی جدید ثبت شد',
        body: '${ticket.title} — ${ticket.locationLabel}',
        category: NotificationCategory.maintenance,
        severity: AlertSeverity.info,
        route: '/maintenance/${ticket.id}',
      );
    }
  }

  void onTicketAssigned(MaintenanceTicket ticket, String assigneeId) {
    notifyUser(
      assigneeId,
      title: 'تیکت جدید به شما ارجاع شد',
      body: '${ticket.title} — ${ticket.locationLabel}',
      category: NotificationCategory.maintenance,
      severity: ticket.priority == TicketPriority.critical
          ? AlertSeverity.critical
          : AlertSeverity.warning,
      route: '/maintenance/${ticket.id}',
    );
  }

  void onStockChanged(InventoryItem item) {
    if (!item.isLowStock) return;
    final exists = store.alerts.all.any(
      (a) => a.type == AlertType.lowStock &&
          a.status == AlertStatus.open &&
          a.route == '/inventory/${item.id}',
    );
    if (exists) return;
    _raise(
      AlertType.lowStock,
      item.isOutOfStock ? AlertSeverity.critical : AlertSeverity.warning,
      'کمبود موجودی: ${item.name}',
      'موجودی ${item.quantity.toStringAsFixed(0)} ${item.unit}، '
          'نقطه سفارش ${item.reorderLevel.toStringAsFixed(0)}',
      '/inventory/${item.id}',
      {AppRole.inventoryManager, AppRole.generalManager},
    );
  }

  void onTaskAssigned(String assigneeId, String roomNumber) {
    notifyUser(
      assigneeId,
      title: 'وظیفه جدید نظافت',
      body: 'اتاق $roomNumber به لیست کارهای شما اضافه شد.',
      category: NotificationCategory.task,
      severity: AlertSeverity.info,
      route: '/housekeeping',
    );
  }

  void notifyRoles(
    Set<AppRole> roles, {
    required String title,
    required String body,
    required NotificationCategory category,
    required AlertSeverity severity,
    String? route,
  }) {
    for (final account in store.accounts.where((a) => roles.contains(a.role))) {
      notifyUser(
        account.uid,
        title: title,
        body: body,
        category: category,
        severity: severity,
        route: route,
      );
    }
  }

  void notifyUser(
    String uid, {
    required String title,
    required String body,
    required NotificationCategory category,
    required AlertSeverity severity,
    String? route,
  }) {
    final id = store.nextId('n');
    store.inbox.put(
      Scoped(
        uid,
        id,
        InboxNotification(
          id: id,
          title: title,
          body: body,
          category: category,
          severity: severity,
          createdAt: store.clock.now(),
          route: route,
        ),
      ),
    );
  }

  void _raise(
    AlertType type,
    AlertSeverity severity,
    String title,
    String message,
    String route,
    Set<AppRole> audience,
  ) {
    store.alerts.put(
      HotelAlert(
        id: store.nextId('al'),
        type: type,
        severity: severity,
        title: title,
        message: message,
        status: AlertStatus.open,
        createdAt: store.clock.now(),
        route: route,
      ),
    );
    notifyRoles(
      audience,
      title: title,
      body: message,
      category: NotificationCategory.alert,
      severity: severity,
      route: route,
    );
  }

  static String _energyLabel(EnergyType type) => switch (type) {
    EnergyType.electricity => 'برق',
    EnergyType.water => 'آب',
    EnergyType.gas => 'گاز',
  };
}
