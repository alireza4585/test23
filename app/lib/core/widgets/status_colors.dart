import 'package:flutter/material.dart';

import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/rooms/domain/room.dart';
import '../theme/app_colors.dart';

/// Maps domain states to semantic colours + icons. Colour is never the only
/// signal: every usage pairs it with a text label and/or icon.
extension StatusVisuals on BuildContext {
  Color roomStatusColor(RoomStatus s) => switch (s) {
    RoomStatus.vacantClean => status.success,
    RoomStatus.cleaningInProgress => status.info,
    RoomStatus.vacantDirty => status.warning,
    RoomStatus.occupied => status.neutral,
    RoomStatus.outOfOrder => status.danger,
  };

  Color ticketPriorityColor(TicketPriority p) => switch (p) {
    TicketPriority.low => status.neutral,
    TicketPriority.medium => status.info,
    TicketPriority.high => status.warning,
    TicketPriority.critical => status.danger,
  };

  Color ticketStatusColor(TicketStatus s) => switch (s) {
    TicketStatus.open => status.warning,
    TicketStatus.assigned => status.info,
    TicketStatus.inProgress => status.info,
    TicketStatus.onHold => status.neutral,
    TicketStatus.resolved => status.success,
    TicketStatus.closed => status.neutral,
    TicketStatus.cancelled => status.neutral,
  };

  Color taskStatusColor(TaskStatus s) => switch (s) {
    TaskStatus.pending => status.warning,
    TaskStatus.inProgress => status.info,
    TaskStatus.done => status.success,
    TaskStatus.cancelled => status.neutral,
  };

  Color taskPriorityColor(TaskPriority p) => switch (p) {
    TaskPriority.low => status.neutral,
    TaskPriority.normal => status.info,
    TaskPriority.high => status.warning,
    TaskPriority.urgent => status.danger,
  };

  Color severityColor(AlertSeverity s) => switch (s) {
    AlertSeverity.info => status.info,
    AlertSeverity.warning => status.warning,
    AlertSeverity.critical => status.danger,
  };
}

IconData roomStatusIcon(RoomStatus s) => switch (s) {
  RoomStatus.vacantClean => Icons.check_circle_outline,
  RoomStatus.cleaningInProgress => Icons.cleaning_services_outlined,
  RoomStatus.vacantDirty => Icons.bed_outlined,
  RoomStatus.occupied => Icons.person_outline,
  RoomStatus.outOfOrder => Icons.build_outlined,
};

IconData severityIcon(AlertSeverity s) => switch (s) {
  AlertSeverity.info => Icons.info_outline,
  AlertSeverity.warning => Icons.warning_amber_rounded,
  AlertSeverity.critical => Icons.error_outline,
};

IconData ticketCategoryIcon(TicketCategory c) => switch (c) {
  TicketCategory.hvac => Icons.ac_unit,
  TicketCategory.electrical => Icons.electrical_services,
  TicketCategory.plumbing => Icons.plumbing,
  TicketCategory.furniture => Icons.chair_outlined,
  TicketCategory.appliance => Icons.tv_outlined,
  TicketCategory.itNetwork => Icons.wifi,
  TicketCategory.structural => Icons.foundation,
  TicketCategory.other => Icons.handyman_outlined,
};
