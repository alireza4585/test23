import '../../../core/security/app_permission.dart';
import '../../auth/domain/app_user.dart';
import '../../hotel/domain/hotel.dart';
import 'maintenance_ticket.dart';

/// Ticket lifecycle rules and SLA computation.
///
/// ```text
/// open ──assign──▶ assigned ──start──▶ inProgress ──▶ resolved ──▶ closed
///   │                 │                  │   ▲
///   └──cancel         └──cancel          ▼   │
///                                      onHold
/// ```
abstract final class TicketWorkflow {
  static const Map<TicketStatus, Set<TicketStatus>> _transitions = {
    TicketStatus.open: {
      TicketStatus.assigned,
      TicketStatus.inProgress,
      TicketStatus.cancelled,
    },
    TicketStatus.assigned: {
      TicketStatus.inProgress,
      TicketStatus.open,
      TicketStatus.cancelled,
    },
    TicketStatus.inProgress: {TicketStatus.onHold, TicketStatus.resolved},
    TicketStatus.onHold: {TicketStatus.inProgress, TicketStatus.cancelled},
    TicketStatus.resolved: {TicketStatus.closed, TicketStatus.inProgress},
    TicketStatus.closed: {},
    TicketStatus.cancelled: {},
  };

  /// Transitions a technician may perform on a ticket assigned to them.
  static const Set<TicketStatus> _technicianTargets = {
    TicketStatus.inProgress,
    TicketStatus.onHold,
    TicketStatus.resolved,
  };

  static Set<TicketStatus> allowedTargets(
    AppUser user,
    MaintenanceTicket ticket,
  ) {
    final next = _transitions[ticket.status] ?? const <TicketStatus>{};
    if (user.can(AppPermission.maintenanceManage)) return next;
    if (user.can(AppPermission.maintenanceWork) &&
        ticket.assigneeId == user.uid) {
      return next.intersection(_technicianTargets);
    }
    return const {};
  }

  static DateTime slaDueAt(
    TicketPriority priority,
    DateTime createdAt,
    HotelSettings settings,
  ) {
    final hours = settings.maintenanceSlaHours[priority.name] ??
        switch (priority) {
          TicketPriority.critical => 2,
          TicketPriority.high => 8,
          TicketPriority.medium => 24,
          TicketPriority.low => 72,
        };
    return createdAt.add(Duration(hours: hours));
  }
}
