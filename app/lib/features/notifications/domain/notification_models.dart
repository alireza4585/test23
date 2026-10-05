import '../../../core/domain/actor.dart';

enum AlertSeverity { info, warning, critical }

enum AlertStatus { open, acknowledged, resolved }

enum AlertType { energySpike, lowStock, maintenanceSla, criticalTicket, system, ai }

/// An operational condition detected by the rule engine, AI, IoT or n8n.
/// Alerts have a lifecycle; notifications (below) are just delivery.
class HotelAlert {
  const HotelAlert({
    required this.id,
    required this.type,
    required this.severity,
    required this.title,
    required this.message,
    required this.status,
    required this.createdAt,
    this.route,
    this.acknowledgedByName,
  });

  final String id;
  final AlertType type;
  final AlertSeverity severity;
  final String title;
  final String message;
  final AlertStatus status;
  final DateTime createdAt;

  /// In-app deep link, e.g. `/energy` or `/maintenance/abc`.
  final String? route;
  final String? acknowledgedByName;
}

enum NotificationCategory { alert, task, maintenance, inventory, report, ai, system }

/// A message in a user's personal inbox (`users/{uid}/inbox`). Fanned out by
/// the backend from hotel-level notifications, also delivered as push.
class InboxNotification {
  const InboxNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.category,
    required this.severity,
    required this.createdAt,
    this.route,
    this.readAt,
  });

  final String id;
  final String title;
  final String body;
  final NotificationCategory category;
  final AlertSeverity severity;
  final DateTime createdAt;
  final String? route;
  final DateTime? readAt;

  bool get isUnread => readAt == null;
}

abstract interface class NotificationsRepository {
  Stream<List<InboxNotification>> watchInbox(String uid, {int limit = 50});

  Future<void> markRead(String uid, String notificationId);

  Future<void> markAllRead(String uid);

  /// Alerts visible to [roleCode] (audience-filtered by the backend).
  Stream<List<HotelAlert>> watchAlerts(
    String hotelId, {
    required String roleCode,
    bool openOnly = true,
  });

  Future<void> acknowledgeAlert(String hotelId, String alertId, Actor actor);
}
