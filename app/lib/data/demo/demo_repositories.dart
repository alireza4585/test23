import 'dart:typed_data';

import '../../core/domain/actor.dart';
import '../../core/error/app_failure.dart';
import '../../core/security/role_policy.dart';
import '../../core/utils/day_key.dart';
import '../../core/utils/iran_national_id.dart';
import '../../features/admin/domain/user_admin.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/hotel/domain/hotel.dart';
import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/operations/domain/daily_operations.dart';
import '../../features/reports/domain/report_models.dart';
import '../../features/rooms/domain/room.dart';
import '../../features/staff/domain/staff.dart';
import 'demo_automation.dart';
import 'demo_collection.dart';
import 'demo_store.dart';

// The demo backend is single-tenant: `hotelId` parameters are accepted to
// honour the repository contracts but every call targets the seeded hotel.

class DemoHotelRepository implements HotelRepository {
  DemoHotelRepository(this._store);

  final DemoStore _store;

  @override
  Stream<Hotel?> watchHotel(String hotelId) => _store.hotels.watchOne(hotelId);
}

class DemoRoomsRepository implements RoomsRepository {
  DemoRoomsRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<Room>> watchRooms(String hotelId) =>
      _store.rooms.watch(sort: (a, b) => a.number.compareTo(b.number));

  @override
  Stream<Room?> watchRoom(String hotelId, String roomId) =>
      _store.rooms.watchOne(roomId);

  @override
  Future<void> updateStatus({
    required String hotelId,
    required RoomStatusChange change,
    required Actor actor,
    String? note,
  }) async {
    await _store.latency();
    applyRoomChange(_store, change, actor, note: note);
  }

  /// Shared with other demo repositories that change room status as part of
  /// a larger "transaction".
  static void applyRoomChange(
    DemoStore store,
    RoomStatusChange change,
    Actor actor, {
    String? note,
  }) {
    final room = store.rooms.get(change.roomId);
    if (room == null) throw const NotFoundFailure('room');
    if (room.status != change.from) {
      // Optimistic concurrency: someone else changed the room meanwhile.
      throw const ValidationFailure('room_status_changed');
    }
    store.rooms.put(
      room.copyWith(
        status: change.to,
        updatedAt: store.clock.now(),
        updatedByName: actor.name,
        note: note,
      ),
    );
    store.audit(actor.name, 'room.status ${change.from.name}→${change.to.name}', 'rooms/${room.id}');
  }
}

class DemoHousekeepingRepository implements HousekeepingRepository {
  DemoHousekeepingRepository(this._store) : _automation = DemoAutomation(_store);

  final DemoStore _store;
  final DemoAutomation _automation;

  @override
  Stream<List<HousekeepingTask>> watchTasks(
    String hotelId, {
    required DateTime day,
    String? assigneeId,
  }) {
    final key = DayKey.of(day);
    return _store.tasks.watch(
      where: (t) =>
          DayKey.of(t.createdAt) == key &&
          (assigneeId == null || t.assigneeId == assigneeId),
      sort: _byUrgency,
    );
  }

  static int _byUrgency(HousekeepingTask a, HousekeepingTask b) {
    final statusOrder = a.status.index.compareTo(b.status.index);
    if (statusOrder != 0) return statusOrder;
    final priority = b.priority.index.compareTo(a.priority.index);
    if (priority != 0) return priority;
    return a.roomNumber.compareTo(b.roomNumber);
  }

  @override
  Stream<HousekeepingTask?> watchTask(String hotelId, String taskId) =>
      _store.tasks.watchOne(taskId);

  @override
  Future<String> createTask(
    String hotelId,
    HousekeepingTaskDraft draft,
    Actor actor,
  ) async {
    await _store.latency();
    final id = _store.nextId('t');
    _store.tasks.put(
      HousekeepingTask(
        id: id,
        roomId: draft.roomId,
        roomNumber: draft.roomNumber,
        type: draft.type,
        status: TaskStatus.pending,
        priority: draft.priority,
        createdAt: _store.clock.now(),
        assigneeId: draft.assigneeId,
        assigneeName: draft.assigneeName,
        dueAt: draft.dueAt,
        notes: draft.notes,
        createdByName: actor.name,
      ),
    );
    if (draft.assigneeId != null) {
      _automation.onTaskAssigned(draft.assigneeId!, draft.roomNumber);
    }
    _store.audit(actor.name, 'task.create', 'tasks/$id');
    return id;
  }

  @override
  Future<void> transition(
    String hotelId, {
    required HousekeepingTask task,
    required TaskStatus status,
    required Actor actor,
    RoomStatusChange? roomChange,
    String? notes,
  }) async {
    await _store.latency();
    if (roomChange != null) {
      DemoRoomsRepository.applyRoomChange(_store, roomChange, actor);
    }
    _store.tasks.put(task.copyWith(status: status, notes: notes));
    _store.audit(actor.name, 'task.${status.name}', 'tasks/${task.id}');
  }
}

class DemoMaintenanceRepository implements MaintenanceRepository {
  DemoMaintenanceRepository(this._store) : _automation = DemoAutomation(_store);

  final DemoStore _store;
  final DemoAutomation _automation;

  @override
  Stream<List<MaintenanceTicket>> watchTickets(
    String hotelId, {
    required TicketScope scope,
    bool activeOnly = false,
  }) {
    return _store.tickets.watch(
      where: (t) {
        if (activeOnly && !t.status.isActive) return false;
        return switch (scope) {
          AllTickets() => true,
          MyTickets(:final uid) => t.reportedById == uid || t.assigneeId == uid,
        };
      },
      sort: (a, b) {
        final p = b.priority.index.compareTo(a.priority.index);
        return p != 0 ? p : b.createdAt.compareTo(a.createdAt);
      },
    );
  }

  @override
  Stream<MaintenanceTicket?> watchTicket(String hotelId, String ticketId) =>
      _store.tickets.watchOne(ticketId);

  @override
  Stream<List<TicketEvent>> watchEvents(String hotelId, String ticketId) =>
      _store.ticketEvents
          .watch(
            where: (e) => e.scope == ticketId,
            sort: (a, b) => a.value.at.compareTo(b.value.at),
          )
          .map((list) => [for (final e in list) e.value]);

  @override
  Future<String> createTicket(
    String hotelId,
    TicketDraft draft,
    Actor actor, {
    required DateTime slaDueAt,
  }) async {
    await _store.latency();
    final id = _store.nextId('mt');
    final now = _store.clock.now();
    final ticket = MaintenanceTicket(
      id: id,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      priority: draft.priority,
      status: TicketStatus.open,
      reportedById: actor.uid,
      reportedByName: actor.name,
      createdAt: now,
      updatedAt: now,
      slaDueAt: slaDueAt,
      roomId: draft.roomId,
      roomNumber: draft.roomNumber,
      area: draft.area,
      photoPaths: [
        for (var i = 0; i < draft.photos.length; i++)
          'demo://maintenance/$id/${draft.photos[i].name}',
      ],
    );
    _store.tickets.put(ticket);
    _addEvent(id, TicketEvent(
      id: _store.nextId('ev'),
      type: TicketEventType.created,
      actorName: actor.name,
      at: now,
      toStatus: TicketStatus.open,
      note: draft.description,
    ));
    _automation.onTicketCreated(ticket);
    _store.audit(actor.name, 'ticket.create', 'maintenanceTickets/$id');
    return id;
  }

  @override
  Future<void> changeStatus(
    String hotelId, {
    required MaintenanceTicket ticket,
    required TicketStatus to,
    required Actor actor,
    String? note,
  }) async {
    await _store.latency();
    final now = _store.clock.now();
    final resolved = to == TicketStatus.resolved;
    _store.tickets.put(
      MaintenanceTicket(
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: to,
        reportedById: ticket.reportedById,
        reportedByName: ticket.reportedByName,
        createdAt: ticket.createdAt,
        slaDueAt: ticket.slaDueAt,
        roomId: ticket.roomId,
        roomNumber: ticket.roomNumber,
        area: ticket.area,
        assigneeId: ticket.assigneeId,
        assigneeName: ticket.assigneeName,
        photoPaths: ticket.photoPaths,
        updatedAt: now,
        resolvedAt: resolved ? now : ticket.resolvedAt,
        resolutionNote: resolved ? note : ticket.resolutionNote,
      ),
    );
    _addEvent(ticket.id, TicketEvent(
      id: _store.nextId('ev'),
      type: TicketEventType.statusChanged,
      actorName: actor.name,
      at: now,
      fromStatus: ticket.status,
      toStatus: to,
      note: note,
    ));
    _store.audit(actor.name, 'ticket.${to.name}', 'maintenanceTickets/${ticket.id}');
  }

  @override
  Future<void> assign(
    String hotelId, {
    required MaintenanceTicket ticket,
    required String assigneeId,
    required String assigneeName,
    required Actor actor,
  }) async {
    await _store.latency();
    final now = _store.clock.now();
    final updated = MaintenanceTicket(
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status == TicketStatus.open ? TicketStatus.assigned : ticket.status,
      reportedById: ticket.reportedById,
      reportedByName: ticket.reportedByName,
      createdAt: ticket.createdAt,
      slaDueAt: ticket.slaDueAt,
      roomId: ticket.roomId,
      roomNumber: ticket.roomNumber,
      area: ticket.area,
      assigneeId: assigneeId,
      assigneeName: assigneeName,
      photoPaths: ticket.photoPaths,
      updatedAt: now,
      resolvedAt: ticket.resolvedAt,
      resolutionNote: ticket.resolutionNote,
    );
    _store.tickets.put(updated);
    _addEvent(ticket.id, TicketEvent(
      id: _store.nextId('ev'),
      type: TicketEventType.assigned,
      actorName: actor.name,
      at: now,
      note: assigneeName,
    ));
    _automation.onTicketAssigned(updated, assigneeId);
    _store.audit(actor.name, 'ticket.assign', 'maintenanceTickets/${ticket.id}');
  }

  void _addEvent(String ticketId, TicketEvent event) =>
      _store.ticketEvents.put(Scoped(ticketId, event.id, event));
}

class DemoEnergyRepository implements EnergyRepository {
  DemoEnergyRepository(this._store) : _automation = DemoAutomation(_store);

  final DemoStore _store;
  final DemoAutomation _automation;

  @override
  Stream<List<EnergyReading>> watchReadings(
    String hotelId, {
    required DateTime from,
    required DateTime to,
  }) {
    final start = DayKey.startOfDay(from);
    final end = DayKey.startOfDay(to);
    return _store.energy.watch(
      where: (r) => !r.day.isBefore(start) && !r.day.isAfter(end),
      sort: (a, b) => a.day.compareTo(b.day),
    );
  }

  @override
  Future<void> saveReading(
    String hotelId,
    EnergyReadingDraft draft,
    Actor actor,
  ) async {
    await _store.latency();
    if (draft.consumption < 0) {
      throw const ValidationFailure('negative_consumption');
    }
    final reading = EnergyReading(
      id: '${DayKey.of(draft.day)}_${draft.type.name}',
      type: draft.type,
      day: DayKey.startOfDay(draft.day),
      consumption: draft.consumption,
      source: ReadingSource.manual,
      recordedByName: actor.name,
      createdAt: _store.clock.now(),
      meterValue: draft.meterValue,
      cost: draft.cost,
      note: draft.note,
    );
    _store.energy.put(reading);
    _automation.onEnergyReading(reading);
    _store.audit(actor.name, 'energy.save', 'energyReadings/${reading.id}');
  }
}

class DemoOperationsRepository implements OperationsRepository {
  DemoOperationsRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<DailyOperations>> watchRange(
    String hotelId, {
    required DateTime from,
    required DateTime to,
  }) {
    final start = DayKey.startOfDay(from);
    final end = DayKey.startOfDay(to);
    return _store.operations.watch(
      where: (o) => !o.day.isBefore(start) && !o.day.isAfter(end),
      sort: (a, b) => a.day.compareTo(b.day),
    );
  }

  @override
  Future<void> save(
    String hotelId,
    DailyOperations operations,
    Actor actor,
  ) async {
    await _store.latency();
    if (operations.roomsOccupied > operations.roomsAvailable) {
      throw const ValidationFailure('occupied_exceeds_available');
    }
    _store.operations.put(
      DailyOperations(
        day: DayKey.startOfDay(operations.day),
        roomsAvailable: operations.roomsAvailable,
        roomsOccupied: operations.roomsOccupied,
        guests: operations.guests,
        roomRevenue: operations.roomRevenue,
        fnbRevenue: operations.fnbRevenue,
        otherRevenue: operations.otherRevenue,
        updatedByName: actor.name,
        updatedAt: _store.clock.now(),
      ),
    );
    _store.audit(actor.name, 'operations.save', 'dailyOperations/${DayKey.of(operations.day)}');
  }
}

class DemoInventoryRepository implements InventoryRepository {
  DemoInventoryRepository(this._store) : _automation = DemoAutomation(_store);

  final DemoStore _store;
  final DemoAutomation _automation;

  @override
  Stream<List<InventoryItem>> watchItems(String hotelId) =>
      _store.items.watch(sort: (a, b) => a.name.compareTo(b.name));

  @override
  Stream<InventoryItem?> watchItem(String hotelId, String itemId) =>
      _store.items.watchOne(itemId);

  @override
  Stream<List<StockMovement>> watchMovements(
    String hotelId, {
    String? itemId,
    int limit = 30,
  }) => _store.movements.watch(
    where: (m) => itemId == null || m.itemId == itemId,
    sort: (a, b) => b.createdAt.compareTo(a.createdAt),
    limit: limit,
  );

  @override
  Future<void> recordMovement(
    String hotelId, {
    required String itemId,
    required MovementType type,
    required double delta,
    required Actor actor,
    String? reason,
  }) async {
    await _store.latency();
    final item = _store.items.get(itemId);
    if (item == null) throw const NotFoundFailure('inventory_item');
    final after = item.quantity + delta;
    if (after < 0) throw const ValidationFailure('insufficient_stock');
    final now = _store.clock.now();
    final updated = InventoryItem(
      id: item.id,
      name: item.name,
      sku: item.sku,
      category: item.category,
      unit: item.unit,
      quantity: after,
      reorderLevel: item.reorderLevel,
      reorderQuantity: item.reorderQuantity,
      location: item.location,
      unitCost: item.unitCost,
      updatedAt: now,
    );
    _store.items.put(updated);
    _store.movements.put(
      StockMovement(
        id: _store.nextId('mv'),
        itemId: item.id,
        itemName: item.name,
        type: type,
        delta: delta,
        quantityAfter: after,
        actorName: actor.name,
        createdAt: now,
        reason: reason,
      ),
    );
    _automation.onStockChanged(updated);
    _store.audit(actor.name, 'inventory.${type.name} $delta', 'inventoryItems/${item.id}');
  }

  @override
  Future<String> createItem(
    String hotelId,
    InventoryItemDraft draft,
    Actor actor,
  ) async {
    await _store.latency();
    final id = _store.nextId('inv');
    _store.items.put(
      InventoryItem(
        id: id,
        name: draft.name,
        sku: draft.sku,
        category: draft.category,
        unit: draft.unit,
        quantity: draft.initialQuantity,
        reorderLevel: draft.reorderLevel,
        reorderQuantity: draft.reorderQuantity,
        location: draft.location,
        unitCost: draft.unitCost,
        updatedAt: _store.clock.now(),
      ),
    );
    _store.audit(actor.name, 'inventory.create', 'inventoryItems/$id');
    return id;
  }
}

class DemoStaffRepository implements StaffRepository {
  DemoStaffRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<StaffMember>> watchStaff(String hotelId) => _store.staff.watch(
    where: (s) => s.active,
    sort: (a, b) {
      final d = a.department.index.compareTo(b.department.index);
      return d != 0 ? d : a.fullName.compareTo(b.fullName);
    },
  );

  @override
  Stream<List<Shift>> watchShifts(
    String hotelId, {
    required DateTime day,
    String? userId,
  }) {
    final key = DayKey.of(day);
    return _store.shifts.watch(
      where: (s) =>
          DayKey.of(s.day) == key && (userId == null || s.userId == userId),
      sort: (a, b) {
        final t = a.type.index.compareTo(b.type.index);
        return t != 0 ? t : a.staffName.compareTo(b.staffName);
      },
    );
  }

  @override
  Future<void> createShift(String hotelId, ShiftDraft draft, Actor actor) async {
    await _store.latency();
    final (start, end) = draft.hours;
    final id = _store.nextId('sh');
    _store.shifts.put(
      Shift(
        id: id,
        staffId: draft.staff.id,
        staffName: draft.staff.fullName,
        department: draft.staff.department,
        day: DayKey.startOfDay(draft.day),
        type: draft.type,
        startTime: start,
        endTime: end,
        status: ShiftStatus.scheduled,
        userId: draft.staff.userId,
      ),
    );
    _store.audit(actor.name, 'shift.create', 'shifts/$id');
  }

  @override
  Future<void> updateShiftStatus(
    String hotelId, {
    required String shiftId,
    required ShiftStatus status,
    required Actor actor,
  }) async {
    await _store.latency();
    final s = _store.shifts.get(shiftId);
    if (s == null) throw const NotFoundFailure('shift');
    _store.shifts.put(
      Shift(
        id: s.id,
        staffId: s.staffId,
        staffName: s.staffName,
        department: s.department,
        day: s.day,
        type: s.type,
        startTime: s.startTime,
        endTime: s.endTime,
        status: status,
        userId: s.userId,
      ),
    );
  }
}

class DemoNotificationsRepository implements NotificationsRepository {
  DemoNotificationsRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<InboxNotification>> watchInbox(String uid, {int limit = 50}) =>
      _store.inbox
          .watch(
            where: (n) => n.scope == uid,
            sort: (a, b) => b.value.createdAt.compareTo(a.value.createdAt),
            limit: limit,
          )
          .map((list) => [for (final n in list) n.value]);

  @override
  Future<void> markRead(String uid, String notificationId) async {
    final n = _store.inbox.get(notificationId);
    if (n == null || n.value.readAt != null) return;
    _store.inbox.put(Scoped(uid, notificationId, _read(n.value)));
  }

  @override
  Future<void> markAllRead(String uid) async {
    for (final n in _store.inbox.all.where((n) => n.scope == uid).toList()) {
      if (n.value.readAt == null) {
        _store.inbox.put(Scoped(uid, n.id, _read(n.value)));
      }
    }
  }

  InboxNotification _read(InboxNotification n) => InboxNotification(
    id: n.id,
    title: n.title,
    body: n.body,
    category: n.category,
    severity: n.severity,
    createdAt: n.createdAt,
    route: n.route,
    readAt: _store.clock.now(),
  );

  @override
  Stream<List<HotelAlert>> watchAlerts(
    String hotelId, {
    required String roleCode,
    bool openOnly = true,
  }) => _store.alerts.watch(
    where: (a) => !openOnly || a.status != AlertStatus.resolved,
    sort: (a, b) {
      final s = b.severity.index.compareTo(a.severity.index);
      return s != 0 ? s : b.createdAt.compareTo(a.createdAt);
    },
  );

  @override
  Future<void> acknowledgeAlert(
    String hotelId,
    String alertId,
    Actor actor,
  ) async {
    final a = _store.alerts.get(alertId);
    if (a == null) return;
    _store.alerts.put(
      HotelAlert(
        id: a.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        message: a.message,
        status: AlertStatus.acknowledged,
        createdAt: a.createdAt,
        route: a.route,
        acknowledgedByName: actor.name,
      ),
    );
    _store.audit(actor.name, 'alert.acknowledge', 'alerts/$alertId');
  }
}

class DemoInsightsRepository implements InsightsRepository {
  DemoInsightsRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<AiInsight>> watchInsights(
    String hotelId, {
    bool activeOnly = true,
  }) => _store.insights.watch(
    where: (i) => !activeOnly || i.status == InsightStatus.active,
    sort: (a, b) => b.createdAt.compareTo(a.createdAt),
  );

  @override
  Future<void> updateStatus(
    String hotelId,
    String insightId,
    InsightStatus status,
    Actor actor,
  ) async {
    await _store.latency();
    final i = _store.insights.get(insightId);
    if (i == null) throw const NotFoundFailure('insight');
    _store.insights.put(
      AiInsight(
        id: i.id,
        category: i.category,
        title: i.title,
        summary: i.summary,
        recommendation: i.recommendation,
        confidence: i.confidence,
        status: status,
        source: i.source,
        createdAt: i.createdAt,
        evidence: i.evidence,
        estimatedMonthlySaving: i.estimatedMonthlySaving,
        route: i.route,
      ),
    );
    _store.audit(actor.name, 'insight.${status.name}', 'aiInsights/$insightId');
  }
}

class DemoReportsRepository implements ReportsRepository {
  DemoReportsRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<ReportRecord>> watchReports(String hotelId, {int limit = 20}) =>
      _store.reports.watch(
        sort: (a, b) => b.createdAt.compareTo(a.createdAt),
        limit: limit,
      );

  @override
  Future<ReportRecord> archive(
    String hotelId, {
    required ReportType type,
    required DateTime from,
    required DateTime to,
    required Uint8List pdfBytes,
    required Actor actor,
  }) async {
    final record = ReportRecord(
      id: _store.nextId('rp'),
      type: type,
      from: from,
      to: to,
      createdAt: _store.clock.now(),
      createdByName: actor.name,
    );
    _store.reports.put(record);
    _store.audit(actor.name, 'report.generate ${type.name}', 'reports/${record.id}');
    return record;
  }
}

class DemoUserAdminRepository implements UserAdminRepository {
  DemoUserAdminRepository(this._store);

  final DemoStore _store;

  @override
  Stream<List<ManagedUser>> watchUsers(String hotelId) {
    // Accounts are a plain map; piggy-back on the staff collection's change
    // stream so the list refreshes after createUser / setStatus.
    return _store.staff.watch().map((_) => _snapshot(hotelId));
  }

  List<ManagedUser> _snapshot(String hotelId) {
    final users = [
      for (final a in _store.accounts)
        if (a.hotelIds.contains(hotelId))
          ManagedUser(
            uid: a.uid,
            fullName: a.fullName,
            nationalIdMasked: IranNationalId.mask(a.nationalId),
            role: a.role,
            status: a.status,
            phone: a.phone,
            lastLoginAt: a.lastLoginAt,
          ),
    ]..sort((a, b) => a.role.index.compareTo(b.role.index));
    return users;
  }

  @override
  Future<String> createUser(NewUserRequest request) async {
    await _store.latency();
    final nid = IranNationalId.normalize(request.nationalId);
    if (!IranNationalId.isValid(nid)) {
      throw const ValidationFailure('invalid_national_id');
    }
    if (_store.accountsByNationalId.containsKey(nid)) {
      throw const ValidationFailure('national_id_exists');
    }
    if (!RolePolicy.defaults.containsKey(request.role)) {
      throw const ValidationFailure('invalid_role');
    }
    final uid = _store.nextId('u');
    _store.accountsByNationalId[nid] = DemoAccount(
      uid: uid,
      nationalId: nid,
      password: request.temporaryPassword,
      fullName: request.fullName,
      role: request.role,
      hotelIds: [request.hotelId],
      staffId: 's-$uid',
      phone: request.phone,
    );
    _store.staff.put(
      StaffMember(
        id: 's-$uid',
        fullName: request.fullName,
        department: request.role.department,
        position: request.role.code,
        role: request.role,
        userId: uid,
        phone: request.phone,
      ),
    );
    _store.audit('admin', 'user.create ${request.role.code}', 'users/$uid');
    return uid;
  }

  @override
  Future<void> setStatus({
    required String hotelId,
    required String uid,
    required UserStatus status,
  }) async {
    await _store.latency();
    final account = _store.accountByUid(uid);
    if (account == null) throw const NotFoundFailure('user');
    account.status = status;
    if (status != UserStatus.active && _store.signedInUid == uid) {
      _store.signedInUid = null;
      _store.authChanges.add(null);
    }
    // Nudge listeners.
    final staff = _store.staff.get(account.staffId ?? '');
    if (staff != null) _store.staff.put(staff);
    _store.audit('admin', 'user.status ${status.name}', 'users/$uid');
  }

  @override
  Future<void> resetPassword({
    required String hotelId,
    required String uid,
    required String temporaryPassword,
  }) async {
    await _store.latency();
    final account = _store.accountByUid(uid);
    if (account == null) throw const NotFoundFailure('user');
    account.password = temporaryPassword;
    _store.audit('admin', 'user.resetPassword', 'users/$uid');
  }
}
