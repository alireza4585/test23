import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:pocketbase/pocketbase.dart';

import '../../core/domain/actor.dart';
import '../../core/error/app_failure.dart';
import '../../core/security/app_role.dart';
import '../../core/utils/day_key.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/hotel/domain/hotel.dart';
import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/operations/domain/daily_operations.dart';
import '../../features/rooms/domain/room.dart';
import '../../features/staff/domain/staff.dart';
import 'pb_support.dart';

/// Workflow transitions go through the transactional `/api/zarin/*` routes
/// (pocketbase/pb_hooks); reads are live queries guarded by API rules.
abstract class _PbRepository {
  _PbRepository(this.pb) : live = PbLive(pb);

  final PocketBase pb;
  final PbLive live;

  String byHotel(String hotelId, [String extra = '', Map<String, dynamic> params = const {}]) =>
      pb.filter('hotel = {:hotel}${extra.isEmpty ? '' : ' && $extra'}', {'hotel': hotelId, ...params});

  Future<Map<String, dynamic>> command(String path, Map<String, dynamic> body) =>
      pb.send<Map<String, dynamic>>(path, method: 'POST', body: body);
}

// ------------------------------------------------------------------- hotel

class PocketBaseHotelRepository extends _PbRepository implements HotelRepository {
  PocketBaseHotelRepository(super.pb);

  @override
  Stream<Hotel?> watchHotel(String hotelId) => live.one('hotels', hotelId).map((r) {
    if (r == null) return null;
    final settings = r.obj('settings');
    Map<String, double> doubles(String key, Map<String, double> fallback) {
      final m = settings[key];
      if (m is! Map || m.isEmpty) return fallback;
      return {for (final e in m.entries) if (e.value is num) '${e.key}': (e.value as num).toDouble()};
    }

    Map<String, int> ints(String key, Map<String, int> fallback) {
      final m = settings[key];
      if (m is! Map || m.isEmpty) return fallback;
      return {for (final e in m.entries) if (e.value is num) '${e.key}': (e.value as num).toInt()};
    }

    num number(String key, num fallback) => settings[key] is num ? settings[key] as num : fallback;

    const defaults = HotelSettings();
    return Hotel(
      id: r.id,
      name: r.str('name'),
      city: r.str('city'),
      stars: r.integer('stars'),
      roomCount: r.integer('roomCount'),
      timezone: r.strOrNull('timezone') ?? 'Asia/Tehran',
      currency: r.strOrNull('currency') ?? 'IRR',
      settings: HotelSettings(
        energyDailyBaseline: doubles('energyDailyBaseline', defaults.energyDailyBaseline),
        energyTariff: doubles('energyTariff', defaults.energyTariff),
        energyAlertThresholdPct: number('energyAlertThresholdPct', 15).toDouble(),
        maintenanceSlaHours: ints('maintenanceSlaHours', defaults.maintenanceSlaHours),
        targetCleanMinutes: ints('targetCleanMinutes', defaults.targetCleanMinutes),
        sessionTimeoutMinutes: number('sessionTimeoutMinutes', 30).toInt(),
      ),
    );
  });
}

// ------------------------------------------------------------------- rooms

class PocketBaseRoomsRepository extends _PbRepository implements RoomsRepository {
  PocketBaseRoomsRepository(super.pb);

  static Room fromRecord(RecordModel r) => Room(
    id: r.id,
    number: r.str('number'),
    floor: r.integer('floor'),
    type: r.enumValue('type', RoomType.values, RoomType.double),
    status: RoomStatus.fromCode(r.strOrNull('status')),
    updatedAt: r.updatedAt,
    updatedByName: r.strOrNull('updatedByName'),
    note: r.strOrNull('note'),
  );

  @override
  Stream<List<Room>> watchRooms(String hotelId) =>
      live.list('rooms', filter: byHotel(hotelId), sort: 'number').map((l) => l.map(fromRecord).toList());

  @override
  Stream<Room?> watchRoom(String hotelId, String roomId) =>
      live.one('rooms', roomId).map((r) => r == null ? null : fromRecord(r));

  @override
  Future<void> updateStatus({
    required String hotelId,
    required RoomStatusChange change,
    required Actor actor,
    String? note,
  }) => pbGuard(() => command('/api/zarin/rooms/${change.roomId}/status', {
    'from': change.from.name,
    'to': change.to.name,
    'note': ?note,
  }));
}

// ------------------------------------------------------------ housekeeping

class PocketBaseHousekeepingRepository extends _PbRepository implements HousekeepingRepository {
  PocketBaseHousekeepingRepository(super.pb);

  static HousekeepingTask fromRecord(RecordModel r) => HousekeepingTask(
    id: r.id,
    roomId: r.str('room'),
    roomNumber: r.str('roomNumber'),
    type: r.enumValue('type', HousekeepingTaskType.values, HousekeepingTaskType.checkoutClean),
    status: r.enumValue('status', TaskStatus.values, TaskStatus.pending),
    priority: r.enumValue('priority', TaskPriority.values, TaskPriority.normal),
    createdAt: r.createdAt,
    assigneeId: r.strOrNull('assignee'),
    assigneeName: r.strOrNull('assigneeName'),
    dueAt: r.date('dueAt'),
    startedAt: r.date('startedAt'),
    completedAt: r.date('completedAt'),
    notes: r.strOrNull('notes'),
    createdByName: r.strOrNull('createdByName'),
  );

  @override
  Stream<List<HousekeepingTask>> watchTasks(String hotelId, {required DateTime day, String? assigneeId}) {
    final filter = assigneeId == null
        ? byHotel(hotelId, 'kind = "housekeeping" && day = {:day}', {'day': DayKey.of(day)})
        : byHotel(hotelId, 'kind = "housekeeping" && day = {:day} && assignee = {:a}', {
            'day': DayKey.of(day),
            'a': assigneeId,
          });
    return live.list('tasks', filter: filter).map((records) {
      return records.map(fromRecord).toList()
        ..sort((a, b) {
          final st = a.status.index.compareTo(b.status.index);
          if (st != 0) return st;
          final p = b.priority.index.compareTo(a.priority.index);
          return p != 0 ? p : a.roomNumber.compareTo(b.roomNumber);
        });
    });
  }

  @override
  Stream<HousekeepingTask?> watchTask(String hotelId, String taskId) =>
      live.one('tasks', taskId).map((r) => r == null ? null : fromRecord(r));

  @override
  Future<String> createTask(String hotelId, HousekeepingTaskDraft draft, Actor actor) => pbGuard(() async {
    final r = await pb.collection('tasks').create(body: {
      'hotel': hotelId,
      'kind': 'housekeeping',
      'day': DayKey.of(DateTime.now()),
      'room': draft.roomId,
      'type': draft.type.name,
      'status': TaskStatus.pending.name,
      'priority': draft.priority.name,
      'assignee': draft.assigneeId ?? '',
      'dueAt': draft.dueAt == null ? '' : pbDate(draft.dueAt!),
      'notes': draft.notes ?? '',
    });
    return r.id;
  });

  @override
  Future<void> transition(
    String hotelId, {
    required HousekeepingTask task,
    required TaskStatus status,
    required Actor actor,
    RoomStatusChange? roomChange,
    String? notes,
  }) => pbGuard(() => command('/api/zarin/tasks/${task.id}/transition', {
    'status': status.name,
    'expected': task.status.name,
    'notes': ?notes,
    if (roomChange != null)
      'roomChange': {'roomId': roomChange.roomId, 'from': roomChange.from.name, 'to': roomChange.to.name},
  }));
}

// ------------------------------------------------------------- maintenance

class PocketBaseMaintenanceRepository extends _PbRepository implements MaintenanceRepository {
  PocketBaseMaintenanceRepository(super.pb);

  static const _active = '(status = "open" || status = "assigned" || status = "inProgress" || status = "onHold")';

  static MaintenanceTicket fromRecord(RecordModel r) {
    final created = r.createdAt;
    return MaintenanceTicket(
      id: r.id,
      title: r.str('title'),
      description: r.str('description'),
      category: r.enumValue('category', TicketCategory.values, TicketCategory.other),
      priority: r.enumValue('priority', TicketPriority.values, TicketPriority.medium),
      status: r.enumValue('status', TicketStatus.values, TicketStatus.open),
      reportedById: r.str('reportedBy'),
      reportedByName: r.str('reportedByName'),
      createdAt: created,
      slaDueAt: r.date('slaDueAt') ?? created.add(const Duration(hours: 24)),
      roomId: r.strOrNull('room'),
      roomNumber: r.strOrNull('roomNumber'),
      area: r.strOrNull('area'),
      assigneeId: r.strOrNull('assignee'),
      assigneeName: r.strOrNull('assigneeName'),
      photoPaths: r.strings('photos'),
      updatedAt: r.updatedAt,
      resolvedAt: r.date('resolvedAt'),
      resolutionNote: r.strOrNull('resolutionNote'),
    );
  }

  @override
  Stream<List<MaintenanceTicket>> watchTickets(String hotelId, {required TicketScope scope, bool activeOnly = false}) {
    final parts = <String>[
      if (activeOnly) _active,
      if (scope case MyTickets(:final uid)) pb.filter('(reportedBy = {:u} || assignee = {:u})', {'u': uid}),
    ];
    return live.list('maintenanceTickets', filter: byHotel(hotelId, parts.join(' && ')), sort: '-created', limit: 200).map(
      (records) => records.map(fromRecord).toList()
        ..sort((a, b) {
          final p = b.priority.index.compareTo(a.priority.index);
          return p != 0 ? p : b.createdAt.compareTo(a.createdAt);
        }),
    );
  }

  @override
  Stream<MaintenanceTicket?> watchTicket(String hotelId, String ticketId) =>
      live.one('maintenanceTickets', ticketId).map((r) => r == null ? null : fromRecord(r));

  @override
  Stream<List<TicketEvent>> watchEvents(String hotelId, String ticketId) => live
      .list('ticketEvents', filter: pb.filter('ticket = {:t}', {'t': ticketId}), sort: 'created')
      .map(
        (records) => [
          for (final r in records)
            TicketEvent(
              id: r.id,
              type: r.enumValue('type', TicketEventType.values, TicketEventType.comment),
              actorName: r.str('actorName'),
              at: r.createdAt,
              fromStatus: _status(r.strOrNull('fromStatus')),
              toStatus: _status(r.strOrNull('toStatus')),
              note: r.strOrNull('note'),
            ),
        ],
      );

  static TicketStatus? _status(String? name) {
    for (final s in TicketStatus.values) {
      if (s.name == name) return s;
    }
    return null;
  }

  /// SLA, reporter and initial status are set by the server (pb_hooks);
  /// the client value of [slaDueAt] is informational only.
  @override
  Future<String> createTicket(String hotelId, TicketDraft draft, Actor actor, {required DateTime slaDueAt}) =>
      pbGuard(() async {
        final files = [
          for (final (i, photo) in draft.photos.indexed)
            http.MultipartFile.fromBytes(
              'photos',
              photo.bytes,
              filename: photo.name.isEmpty ? 'photo_$i.jpg' : photo.name,
              contentType: MediaType.parse(photo.mimeType),
            ),
        ];
        final r = await pb.collection('maintenanceTickets').create(
          body: {
            'hotel': hotelId,
            'title': draft.title,
            'description': draft.description,
            'category': draft.category.name,
            'priority': draft.priority.name,
            'room': draft.roomId ?? '',
            'area': draft.area ?? '',
          },
          files: files,
        );
        return r.id;
      });

  @override
  Future<void> changeStatus(
    String hotelId, {
    required MaintenanceTicket ticket,
    required TicketStatus to,
    required Actor actor,
    String? note,
  }) => pbGuard(() => command('/api/zarin/tickets/${ticket.id}/status', {
    'to': to.name,
    'expected': ticket.status.name,
    'note': ?note,
  }));

  @override
  Future<void> assign(
    String hotelId, {
    required MaintenanceTicket ticket,
    required String assigneeId,
    required String assigneeName,
    required Actor actor,
  }) => pbGuard(() => command('/api/zarin/tickets/${ticket.id}/assign', {'assigneeId': assigneeId}));
}

// ------------------------------------------------------------------ energy

class PocketBaseEnergyRepository extends _PbRepository implements EnergyRepository {
  PocketBaseEnergyRepository(super.pb);

  @override
  Stream<List<EnergyReading>> watchReadings(String hotelId, {required DateTime from, required DateTime to}) => live
      .list(
        'energyReadings',
        filter: byHotel(hotelId, 'day >= {:from} && day <= {:to}', {'from': DayKey.of(from), 'to': DayKey.of(to)}),
        sort: 'day',
        limit: 1000,
      )
      .map(
        (records) => [
          for (final r in records)
            EnergyReading(
              id: r.id,
              type: r.enumValue('type', EnergyType.values, EnergyType.electricity),
              day: DayKey.parse(r.str('day')),
              consumption: r.dbl('consumption'),
              source: r.enumValue('source', ReadingSource.values, ReadingSource.manual),
              recordedByName: r.str('recordedByName'),
              createdAt: r.createdAt,
              meterValue: r.dblOrNull('meterValue'),
              cost: r.dblOrNull('cost'),
              note: r.strOrNull('note'),
            ),
        ],
      );

  /// One reading per hotel, day and type (unique index): update or create.
  @override
  Future<void> saveReading(String hotelId, EnergyReadingDraft draft, Actor actor) => pbGuard(() async {
    if (draft.consumption < 0) throw const ValidationFailure('negative_consumption');
    final day = DayKey.of(draft.day);
    final body = {
      'hotel': hotelId,
      'type': draft.type.name,
      'day': day,
      'consumption': draft.consumption,
      'meterValue': draft.meterValue ?? 0,
      'cost': draft.cost ?? 0,
      'note': draft.note ?? '',
    };
    final existing = await pb.collection('energyReadings').getList(
      perPage: 1,
      filter: byHotel(hotelId, 'day = {:day} && type = {:type}', {'day': day, 'type': draft.type.name}),
    );
    if (existing.items.isEmpty) {
      await pb.collection('energyReadings').create(body: body);
    } else {
      await pb.collection('energyReadings').update(existing.items.first.id, body: body);
    }
  });
}

// -------------------------------------------------------------- operations

class PocketBaseOperationsRepository extends _PbRepository implements OperationsRepository {
  PocketBaseOperationsRepository(super.pb);

  @override
  Stream<List<DailyOperations>> watchRange(String hotelId, {required DateTime from, required DateTime to}) => live
      .list(
        'dailyOperations',
        filter: byHotel(hotelId, 'day >= {:from} && day <= {:to}', {'from': DayKey.of(from), 'to': DayKey.of(to)}),
        sort: 'day',
        limit: 400,
      )
      .map(
        (records) => [
          for (final r in records)
            DailyOperations(
              day: DayKey.parse(r.str('day')),
              roomsAvailable: r.integer('roomsAvailable'),
              roomsOccupied: r.integer('roomsOccupied'),
              guests: r.integer('guests'),
              roomRevenue: r.dbl('roomRevenue'),
              fnbRevenue: r.dbl('fnbRevenue'),
              otherRevenue: r.dbl('otherRevenue'),
              updatedByName: r.strOrNull('updatedByName'),
              updatedAt: r.updatedAt,
            ),
        ],
      );

  @override
  Future<void> save(String hotelId, DailyOperations o, Actor actor) => pbGuard(() async {
    if (o.roomsOccupied > o.roomsAvailable) throw const ValidationFailure('occupied_exceeds_available');
    final day = DayKey.of(o.day);
    final body = {
      'hotel': hotelId,
      'day': day,
      'roomsAvailable': o.roomsAvailable,
      'roomsOccupied': o.roomsOccupied,
      'guests': o.guests,
      'roomRevenue': o.roomRevenue,
      'fnbRevenue': o.fnbRevenue,
      'otherRevenue': o.otherRevenue,
    };
    final existing = await pb.collection('dailyOperations').getList(
      perPage: 1,
      filter: byHotel(hotelId, 'day = {:day}', {'day': day}),
    );
    if (existing.items.isEmpty) {
      await pb.collection('dailyOperations').create(body: body);
    } else {
      await pb.collection('dailyOperations').update(existing.items.first.id, body: body);
    }
  });
}

// --------------------------------------------------------------- inventory

class PocketBaseInventoryRepository extends _PbRepository implements InventoryRepository {
  PocketBaseInventoryRepository(super.pb);

  static InventoryItem fromRecord(RecordModel r) => InventoryItem(
    id: r.id,
    name: r.str('name'),
    sku: r.str('sku'),
    category: r.enumValue('category', InventoryCategory.values, InventoryCategory.other),
    unit: r.str('unit'),
    quantity: r.dbl('quantity'),
    reorderLevel: r.dbl('reorderLevel'),
    reorderQuantity: r.dbl('reorderQuantity'),
    location: r.strOrNull('location'),
    unitCost: r.dblOrNull('unitCost'),
    updatedAt: r.updatedAt,
  );

  @override
  Stream<List<InventoryItem>> watchItems(String hotelId) =>
      live.list('inventoryItems', filter: byHotel(hotelId), sort: 'name', limit: 1000).map((l) => l.map(fromRecord).toList());

  @override
  Stream<InventoryItem?> watchItem(String hotelId, String itemId) =>
      live.one('inventoryItems', itemId).map((r) => r == null ? null : fromRecord(r));

  @override
  Stream<List<StockMovement>> watchMovements(String hotelId, {String? itemId, int limit = 30}) => live
      .list(
        'inventoryMovements',
        filter: itemId == null ? byHotel(hotelId) : byHotel(hotelId, 'item = {:i}', {'i': itemId}),
        sort: '-created',
        limit: limit,
      )
      .map(
        (records) => [
          for (final r in records)
            StockMovement(
              id: r.id,
              itemId: r.str('item'),
              itemName: r.str('itemName'),
              type: r.enumValue('type', MovementType.values, MovementType.adjust),
              delta: r.dbl('delta'),
              quantityAfter: r.dbl('quantityAfter'),
              actorName: r.str('actorName'),
              createdAt: r.createdAt,
              reason: r.strOrNull('reason'),
            ),
        ],
      );

  /// Item quantity and ledger entry change in one server transaction.
  @override
  Future<void> recordMovement(
    String hotelId, {
    required String itemId,
    required MovementType type,
    required double delta,
    required Actor actor,
    String? reason,
  }) => pbGuard(() => command('/api/zarin/inventory/$itemId/movements', {
    'type': type.name,
    'delta': delta,
    'reason': ?reason,
  }));

  @override
  Future<String> createItem(String hotelId, InventoryItemDraft draft, Actor actor) => pbGuard(() async {
    final r = await pb.collection('inventoryItems').create(body: {
      'hotel': hotelId,
      'name': draft.name,
      'sku': draft.sku,
      'category': draft.category.name,
      'unit': draft.unit,
      'quantity': draft.initialQuantity,
      'reorderLevel': draft.reorderLevel,
      'reorderQuantity': draft.reorderQuantity,
      'location': draft.location ?? '',
      'unitCost': draft.unitCost ?? 0,
    });
    return r.id;
  });
}

// ------------------------------------------------------------------- staff

class PocketBaseStaffRepository extends _PbRepository implements StaffRepository {
  PocketBaseStaffRepository(super.pb);

  @override
  Stream<List<StaffMember>> watchStaff(String hotelId) => live
      .list('staff', filter: byHotel(hotelId, 'active = true'), limit: 1000)
      .map(
        (records) => [
          for (final r in records)
            StaffMember(
              id: r.id,
              fullName: r.str('fullName'),
              department: r.enumValue('department', Department.values, Department.management),
              position: r.str('position'),
              role: AppRole.fromCode(r.strOrNull('role')),
              userId: r.strOrNull('user'),
              phone: r.strOrNull('phone'),
            ),
        ]..sort((a, b) {
          final d = a.department.index.compareTo(b.department.index);
          return d != 0 ? d : a.fullName.compareTo(b.fullName);
        }),
      );

  @override
  Stream<List<Shift>> watchShifts(String hotelId, {required DateTime day, String? userId}) {
    final filter = userId == null
        ? byHotel(hotelId, 'day = {:day}', {'day': DayKey.of(day)})
        : byHotel(hotelId, 'day = {:day} && user = {:u}', {'day': DayKey.of(day), 'u': userId});
    return live.list('shifts', filter: filter, limit: 1000).map(
      (records) => [
        for (final r in records)
          Shift(
            id: r.id,
            staffId: r.str('staff'),
            staffName: r.str('staffName'),
            department: r.enumValue('department', Department.values, Department.management),
            day: DayKey.parse(r.str('day')),
            type: r.enumValue('type', ShiftType.values, ShiftType.morning),
            startTime: r.str('startTime'),
            endTime: r.str('endTime'),
            status: r.enumValue('status', ShiftStatus.values, ShiftStatus.scheduled),
            userId: r.strOrNull('user'),
          ),
      ]..sort((a, b) {
        final t = a.type.index.compareTo(b.type.index);
        return t != 0 ? t : a.staffName.compareTo(b.staffName);
      }),
    );
  }

  @override
  Future<void> createShift(String hotelId, ShiftDraft draft, Actor actor) => pbGuard(() async {
    final (start, end) = draft.hours;
    await pb.collection('shifts').create(body: {
      'hotel': hotelId,
      'staff': draft.staff.id,
      'day': DayKey.of(draft.day),
      'type': draft.type.name,
      'startTime': start,
      'endTime': end,
      'status': ShiftStatus.scheduled.name,
    });
  });

  @override
  Future<void> updateShiftStatus(
    String hotelId, {
    required String shiftId,
    required ShiftStatus status,
    required Actor actor,
  }) => pbGuard(() => pb.collection('shifts').update(shiftId, body: {'status': status.name}));
}
