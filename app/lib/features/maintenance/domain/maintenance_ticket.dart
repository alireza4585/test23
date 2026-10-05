import '../../../core/domain/actor.dart';
import '../../../core/domain/media_file.dart';

enum TicketCategory {
  hvac,
  electrical,
  plumbing,
  furniture,
  appliance,
  itNetwork,
  structural,
  other,
}

enum TicketPriority { low, medium, high, critical }

enum TicketStatus {
  open,
  assigned,
  inProgress,
  onHold,
  resolved,
  closed,
  cancelled;

  bool get isActive =>
      this == open || this == assigned || this == inProgress || this == onHold;
}

class MaintenanceTicket {
  const MaintenanceTicket({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.priority,
    required this.status,
    required this.reportedById,
    required this.reportedByName,
    required this.createdAt,
    required this.slaDueAt,
    this.roomId,
    this.roomNumber,
    this.area,
    this.assigneeId,
    this.assigneeName,
    this.photoPaths = const [],
    this.updatedAt,
    this.resolvedAt,
    this.resolutionNote,
  });

  final String id;
  final String title;
  final String description;
  final TicketCategory category;
  final TicketPriority priority;
  final TicketStatus status;
  final String reportedById;
  final String reportedByName;
  final DateTime createdAt;
  final DateTime slaDueAt;
  final String? roomId;
  final String? roomNumber;

  /// Free-text location for public areas (lobby, kitchen, boiler room…).
  final String? area;
  final String? assigneeId;
  final String? assigneeName;

  /// Storage object paths (never public URLs) of attached photos.
  final List<String> photoPaths;
  final DateTime? updatedAt;
  final DateTime? resolvedAt;
  final String? resolutionNote;

  bool isOverdue(DateTime now) => status.isActive && now.isAfter(slaDueAt);

  Duration? get resolutionTime =>
      resolvedAt?.difference(createdAt);

  String get locationLabel => roomNumber ?? area ?? '—';
}

class TicketDraft {
  const TicketDraft({
    required this.title,
    required this.description,
    required this.category,
    required this.priority,
    this.roomId,
    this.roomNumber,
    this.area,
    this.photos = const [],
  });

  final String title;
  final String description;
  final TicketCategory category;
  final TicketPriority priority;
  final String? roomId;
  final String? roomNumber;
  final String? area;
  final List<MediaFile> photos;
}

enum TicketEventType { created, statusChanged, assigned, comment }

/// Immutable timeline entry (`maintenanceTickets/{id}/events`).
class TicketEvent {
  const TicketEvent({
    required this.id,
    required this.type,
    required this.actorName,
    required this.at,
    this.fromStatus,
    this.toStatus,
    this.note,
  });

  final String id;
  final TicketEventType type;
  final String actorName;
  final DateTime at;
  final TicketStatus? fromStatus;
  final TicketStatus? toStatus;
  final String? note;
}

/// Which tickets a query should return. Staff only see tickets they reported
/// or that are assigned to them; managers see everything.
sealed class TicketScope {
  const TicketScope();
}

final class AllTickets extends TicketScope {
  const AllTickets();
}

final class MyTickets extends TicketScope {
  const MyTickets(this.uid);

  final String uid;
}

abstract interface class MaintenanceRepository {
  Stream<List<MaintenanceTicket>> watchTickets(
    String hotelId, {
    required TicketScope scope,
    bool activeOnly = false,
  });

  Stream<MaintenanceTicket?> watchTicket(String hotelId, String ticketId);

  Stream<List<TicketEvent>> watchEvents(String hotelId, String ticketId);

  Future<String> createTicket(
    String hotelId,
    TicketDraft draft,
    Actor actor, {
    required DateTime slaDueAt,
  });

  Future<void> changeStatus(
    String hotelId, {
    required MaintenanceTicket ticket,
    required TicketStatus to,
    required Actor actor,
    String? note,
  });

  Future<void> assign(
    String hotelId, {
    required MaintenanceTicket ticket,
    required String assigneeId,
    required String assigneeName,
    required Actor actor,
  });
}
