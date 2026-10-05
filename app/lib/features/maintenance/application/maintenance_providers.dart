import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/security/app_role.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../staff/application/staff_providers.dart';
import '../../staff/domain/staff.dart';
import '../domain/maintenance_ticket.dart';
import '../domain/ticket_workflow.dart';

typedef TicketQuery = ({bool mine, bool activeOnly});

final ticketsProvider =
    StreamProvider.family<List<MaintenanceTicket>, TicketQuery>((ref, query) {
      final user = ref.watch(sessionUserProvider);
      if (user == null ||
          !user.hasHotel ||
          !user.canAny(const {
            AppPermission.maintenanceViewOwn,
            AppPermission.maintenanceViewAll,
          })) {
        return Stream.value(const []);
      }
      final canSeeAll = user.can(AppPermission.maintenanceViewAll);
      final TicketScope scope = (query.mine || !canSeeAll)
          ? MyTickets(user.uid)
          : const AllTickets();
      return ref
          .watch(maintenanceRepositoryProvider)
          .watchTickets(user.hotelId, scope: scope, activeOnly: query.activeOnly);
    });

final ticketProvider =
    StreamProvider.autoDispose.family<MaintenanceTicket?, String>((ref, id) {
      final hotelId = ref.watch(activeHotelIdProvider);
      if (hotelId == null) return Stream.value(null);
      return ref.watch(maintenanceRepositoryProvider).watchTicket(hotelId, id);
    });

final ticketEventsProvider =
    StreamProvider.autoDispose.family<List<TicketEvent>, String>((ref, id) {
      final hotelId = ref.watch(activeHotelIdProvider);
      if (hotelId == null) return Stream.value(const []);
      return ref.watch(maintenanceRepositoryProvider).watchEvents(hotelId, id);
    });

/// People a ticket can be assigned to.
final techniciansProvider = Provider<List<StaffMember>>((ref) {
  final staff = ref.watch(staffListProvider).value ?? const [];
  return staff
      .where(
        (s) =>
            s.userId != null &&
            (s.role == AppRole.maintenanceStaff ||
                s.role == AppRole.maintenanceManager),
      )
      .toList();
});

class MaintenanceActions {
  MaintenanceActions(this.ref);

  final Ref ref;

  Future<String> report(TicketDraft draft) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.maintenanceReport)) {
      throw const PermissionDeniedFailure();
    }
    final now = ref.read(clockProvider).now();
    final sla = TicketWorkflow.slaDueAt(
      draft.priority,
      now,
      ref.read(hotelSettingsProvider),
    );
    return ref
        .read(maintenanceRepositoryProvider)
        .createTicket(user.hotelId, draft, user.asActor, slaDueAt: sla);
  }

  Future<void> changeStatus(
    MaintenanceTicket ticket,
    TicketStatus to, {
    String? note,
  }) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!TicketWorkflow.allowedTargets(user, ticket).contains(to)) {
      throw const PermissionDeniedFailure('ticket_transition');
    }
    await ref.read(maintenanceRepositoryProvider).changeStatus(
      user.hotelId,
      ticket: ticket,
      to: to,
      actor: user.asActor,
      note: note,
    );
  }

  Future<void> assign(MaintenanceTicket ticket, StaffMember technician) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.maintenanceManage)) {
      throw const PermissionDeniedFailure();
    }
    await ref.read(maintenanceRepositoryProvider).assign(
      user.hotelId,
      ticket: ticket,
      assigneeId: technician.userId!,
      assigneeName: technician.fullName,
      actor: user.asActor,
    );
  }
}

final maintenanceActionsProvider = Provider<MaintenanceActions>(
  MaintenanceActions.new,
);
