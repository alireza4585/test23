import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:uuid/uuid.dart';

import '../../core/domain/actor.dart';
import '../../core/error/app_failure.dart';
import '../../core/security/app_role.dart';
import '../../core/utils/day_key.dart';
import '../../core/utils/stream_utils.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/hotel/domain/hotel.dart';
import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/operations/domain/daily_operations.dart';
import '../../features/rooms/domain/room.dart';
import '../../features/staff/domain/staff.dart';
import 'firestore_support.dart';

// ------------------------------------------------------------------- hotel

class FirestoreHotelRepository implements HotelRepository {
  FirestoreHotelRepository(this._db);

  final FirebaseFirestore _db;

  @override
  Stream<Hotel?> watchHotel(String hotelId) => _db
      .doc(FsPaths.hotel(hotelId))
      .snapshots()
      .map((s) {
        final d = s.data();
        if (d == null) return null;
        final settings = d.obj('settings');
        Map<String, double> doubles(String key, Map<String, double> fallback) {
          final m = settings.obj(key);
          if (m.isEmpty) return fallback;
          return {for (final e in m.entries) if (e.value is num) e.key: (e.value as num).toDouble()};
        }

        Map<String, int> ints(String key, Map<String, int> fallback) {
          final m = settings.obj(key);
          if (m.isEmpty) return fallback;
          return {for (final e in m.entries) if (e.value is num) e.key: (e.value as num).toInt()};
        }

        const defaults = HotelSettings();
        return Hotel(
          id: s.id,
          name: d.str('name'),
          city: d.str('city'),
          stars: d.integer('stars'),
          roomCount: d.integer('roomCount'),
          timezone: d.str('timezone', 'Asia/Tehran'),
          currency: d.str('currency', 'IRR'),
          settings: HotelSettings(
            energyDailyBaseline: doubles('energyDailyBaseline', defaults.energyDailyBaseline),
            energyTariff: doubles('energyTariff', defaults.energyTariff),
            energyAlertThresholdPct: settings.dbl('energyAlertThresholdPct', 15),
            maintenanceSlaHours: ints('maintenanceSlaHours', defaults.maintenanceSlaHours),
            targetCleanMinutes: ints('targetCleanMinutes', defaults.targetCleanMinutes),
            sessionTimeoutMinutes: settings.integer('sessionTimeoutMinutes', 30),
          ),
        );
      })
      .mapFailures();
}

// ------------------------------------------------------------------- rooms

class FirestoreRoomsRepository implements RoomsRepository {
  FirestoreRoomsRepository(this._db);

  final FirebaseFirestore _db;

  static Room fromDoc(DocumentSnapshot<Json> doc) {
    final d = doc.data() ?? const {};
    return Room(
      id: doc.id,
      number: d.str('number'),
      floor: d.integer('floor'),
      type: d.enumValue('type', RoomType.values, RoomType.double),
      status: RoomStatus.fromCode(d.strOrNull('status')),
      updatedAt: d.date('updatedAt'),
      updatedByName: d.strOrNull('updatedByName'),
      note: d.strOrNull('note'),
    );
  }

  @override
  Stream<List<Room>> watchRooms(String hotelId) => _db
      .collection(FsPaths.rooms(hotelId))
      .orderBy('number')
      .snapshots()
      .map((s) => s.docs.map(fromDoc).toList())
      .mapFailures();

  @override
  Stream<Room?> watchRoom(String hotelId, String roomId) => _db
      .doc('${FsPaths.rooms(hotelId)}/$roomId')
      .snapshots()
      .map((s) => s.exists ? fromDoc(s) : null)
      .mapFailures();

  @override
  Future<void> updateStatus({
    required String hotelId,
    required RoomStatusChange change,
    required Actor actor,
    String? note,
  }) => guard(
    () => _db.runTransaction((tx) async {
      applyRoomChange(tx, await readRoom(_db, tx, hotelId, change), hotelId, change, actor, note: note);
    }),
  );

  static Future<DocumentSnapshot<Json>> readRoom(
    FirebaseFirestore db,
    Transaction tx,
    String hotelId,
    RoomStatusChange change,
  ) => tx.get(db.doc('${FsPaths.rooms(hotelId)}/${change.roomId}'));

  /// Optimistic-concurrency room update used inside transactions.
  static void applyRoomChange(
    Transaction tx,
    DocumentSnapshot<Json> snapshot,
    String hotelId,
    RoomStatusChange change,
    Actor actor, {
    String? note,
  }) {
    if (!snapshot.exists) throw const NotFoundFailure('room');
    if (snapshot.data()?.strOrNull('status') != change.from.name) {
      throw const ValidationFailure('room_status_changed');
    }
    tx.update(snapshot.reference, {
      'status': change.to.name,
      'previousStatus': change.from.name,
      'updatedAt': FieldValue.serverTimestamp(),
      'updatedBy': actorJson(actor),
      'updatedByName': actor.name,
      'note': ?note,
    });
  }
}

// ------------------------------------------------------------ housekeeping

class FirestoreHousekeepingRepository implements HousekeepingRepository {
  FirestoreHousekeepingRepository(this._db);

  final FirebaseFirestore _db;

  static HousekeepingTask fromDoc(DocumentSnapshot<Json> doc) {
    final d = doc.data() ?? const {};
    return HousekeepingTask(
      id: doc.id,
      roomId: d.str('roomId'),
      roomNumber: d.str('roomNumber'),
      type: d.enumValue('type', HousekeepingTaskType.values, HousekeepingTaskType.checkoutClean),
      status: d.enumValue('status', TaskStatus.values, TaskStatus.pending),
      priority: d.enumValue('priority', TaskPriority.values, TaskPriority.normal),
      createdAt: d.dateOrNow('createdAt'),
      assigneeId: d.strOrNull('assigneeId'),
      assigneeName: d.strOrNull('assigneeName'),
      dueAt: d.date('dueAt'),
      startedAt: d.date('startedAt'),
      completedAt: d.date('completedAt'),
      notes: d.strOrNull('notes'),
      createdByName: d.strOrNull('createdByName'),
    );
  }

  @override
  Stream<List<HousekeepingTask>> watchTasks(
    String hotelId, {
    required DateTime day,
    String? assigneeId,
  }) {
    Query<Json> query = _db
        .collection(FsPaths.tasks(hotelId))
        .where('kind', isEqualTo: 'housekeeping')
        .where('day', isEqualTo: DayKey.of(day));
    if (assigneeId != null) {
      // Required for staff: security rules only allow reading own tasks.
      query = query.where('assigneeId', isEqualTo: assigneeId);
    }
    return query
        .snapshots()
        .map((s) {
          final tasks = s.docs.map(fromDoc).toList()
            ..sort((a, b) {
              final st = a.status.index.compareTo(b.status.index);
              if (st != 0) return st;
              final p = b.priority.index.compareTo(a.priority.index);
              return p != 0 ? p : a.roomNumber.compareTo(b.roomNumber);
            });
          return tasks;
        })
        .mapFailures();
  }

  @override
  Stream<HousekeepingTask?> watchTask(String hotelId, String taskId) => _db
      .doc('${FsPaths.tasks(hotelId)}/$taskId')
      .snapshots()
      .map((s) => s.exists ? fromDoc(s) : null)
      .mapFailures();

  @override
  Future<String> createTask(
    String hotelId,
    HousekeepingTaskDraft draft,
    Actor actor,
  ) => guard(() async {
    final ref = _db.collection(FsPaths.tasks(hotelId)).doc();
    await ref.set({
      'kind': 'housekeeping',
      'day': DayKey.of(DateTime.now()),
      'roomId': draft.roomId,
      'roomNumber': draft.roomNumber,
      'type': draft.type.name,
      'status': TaskStatus.pending.name,
      'priority': draft.priority.name,
      'assigneeId': draft.assigneeId,
      'assigneeName': draft.assigneeName,
      'dueAt': draft.dueAt == null ? null : ts(draft.dueAt!),
      'notes': draft.notes,
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': actorJson(actor),
      'createdByName': actor.name,
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return ref.id;
  });

  @override
  Future<void> transition(
    String hotelId, {
    required HousekeepingTask task,
    required TaskStatus status,
    required Actor actor,
    RoomStatusChange? roomChange,
    String? notes,
  }) => guard(
    () => _db.runTransaction((tx) async {
      final taskRef = _db.doc('${FsPaths.tasks(hotelId)}/${task.id}');
      final current = await tx.get(taskRef);
      final roomSnap = roomChange == null
          ? null
          : await FirestoreRoomsRepository.readRoom(_db, tx, hotelId, roomChange);
      if (current.data()?.strOrNull('status') != task.status.name) {
        throw const ValidationFailure('task_status_changed');
      }
      tx.update(taskRef, {
        'status': status.name,
        if (status == TaskStatus.inProgress) 'startedAt': FieldValue.serverTimestamp(),
        if (status == TaskStatus.done) 'completedAt': FieldValue.serverTimestamp(),
        'notes': ?notes,
        'updatedAt': FieldValue.serverTimestamp(),
        'updatedBy': actorJson(actor),
      });
      if (roomChange != null) {
        FirestoreRoomsRepository.applyRoomChange(tx, roomSnap!, hotelId, roomChange, actor);
      }
    }),
  );
}

// ------------------------------------------------------------- maintenance

class FirestoreMaintenanceRepository implements MaintenanceRepository {
  FirestoreMaintenanceRepository(this._db, this._storage);

  final FirebaseFirestore _db;
  final FirebaseStorage _storage;
  static const _uuid = Uuid();

  static MaintenanceTicket fromDoc(DocumentSnapshot<Json> doc) {
    final d = doc.data() ?? const {};
    final created = d.dateOrNow('createdAt');
    return MaintenanceTicket(
      id: doc.id,
      title: d.str('title'),
      description: d.str('description'),
      category: d.enumValue('category', TicketCategory.values, TicketCategory.other),
      priority: d.enumValue('priority', TicketPriority.values, TicketPriority.medium),
      status: d.enumValue('status', TicketStatus.values, TicketStatus.open),
      reportedById: d.str('reportedById'),
      reportedByName: d.str('reportedByName'),
      createdAt: created,
      slaDueAt: d.date('slaDueAt') ?? created.add(const Duration(hours: 24)),
      roomId: d.strOrNull('roomId'),
      roomNumber: d.strOrNull('roomNumber'),
      area: d.strOrNull('area'),
      assigneeId: d.strOrNull('assigneeId'),
      assigneeName: d.strOrNull('assigneeName'),
      photoPaths: d.strings('photoPaths'),
      updatedAt: d.date('updatedAt'),
      resolvedAt: d.date('resolvedAt'),
      resolutionNote: d.strOrNull('resolutionNote'),
    );
  }

  static const _activeStatuses = ['open', 'assigned', 'inProgress', 'onHold'];

  @override
  Stream<List<MaintenanceTicket>> watchTickets(
    String hotelId, {
    required TicketScope scope,
    bool activeOnly = false,
  }) {
    final col = _db.collection(FsPaths.tickets(hotelId));
    Query<Json> base(Query<Json> q) {
      var query = q;
      if (activeOnly) query = query.where('status', whereIn: _activeStatuses);
      return query.orderBy('createdAt', descending: true).limit(200);
    }

    Stream<List<MaintenanceTicket>> run(Query<Json> q) =>
        base(q).snapshots().map((s) => s.docs.map(fromDoc).toList());

    final Stream<List<MaintenanceTicket>> stream = switch (scope) {
      AllTickets() => run(col),
      // Two rule-compliant queries merged client-side (Firestore has no OR
      // across different fields that rules can verify).
      MyTickets(:final uid) => combineLatestLists([
        run(col.where('reportedById', isEqualTo: uid)),
        run(col.where('assigneeId', isEqualTo: uid)),
      ]).map((list) {
        final byId = {for (final t in list) t.id: t};
        return byId.values.toList();
      }),
    };

    return stream.map((list) {
      return list..sort((a, b) {
        final p = b.priority.index.compareTo(a.priority.index);
        return p != 0 ? p : b.createdAt.compareTo(a.createdAt);
      });
    }).mapFailures();
  }

  @override
  Stream<MaintenanceTicket?> watchTicket(String hotelId, String ticketId) => _db
      .doc('${FsPaths.tickets(hotelId)}/$ticketId')
      .snapshots()
      .map((s) => s.exists ? fromDoc(s) : null)
      .mapFailures();

  @override
  Stream<List<TicketEvent>> watchEvents(String hotelId, String ticketId) => _db
      .collection(FsPaths.ticketEvents(hotelId, ticketId))
      .orderBy('at')
      .snapshots()
      .map(
        (s) => [
          for (final doc in s.docs)
            TicketEvent(
              id: doc.id,
              type: doc.data().enumValue('type', TicketEventType.values, TicketEventType.comment),
              actorName: doc.data().str('actorName'),
              at: doc.data().dateOrNow('at'),
              fromStatus: _statusOrNull(doc.data().strOrNull('fromStatus')),
              toStatus: _statusOrNull(doc.data().strOrNull('toStatus')),
              note: doc.data().strOrNull('note'),
            ),
        ],
      )
      .mapFailures();

  static TicketStatus? _statusOrNull(String? name) {
    for (final s in TicketStatus.values) {
      if (s.name == name) return s;
    }
    return null;
  }

  @override
  Future<String> createTicket(
    String hotelId,
    TicketDraft draft,
    Actor actor, {
    required DateTime slaDueAt,
  }) => guard(() async {
    final ref = _db.collection(FsPaths.tickets(hotelId)).doc();
    final photoPaths = <String>[];
    for (final photo in draft.photos) {
      final path = 'hotels/$hotelId/maintenance/${ref.id}/${_uuid.v4()}.jpg';
      await _storage.ref(path).putData(
        photo.bytes,
        SettableMetadata(
          contentType: photo.mimeType,
          customMetadata: {'uploadedBy': actor.uid},
        ),
      );
      photoPaths.add(path);
    }
    final batch = _db.batch()
      ..set(ref, {
        'title': draft.title,
        'description': draft.description,
        'category': draft.category.name,
        'priority': draft.priority.name,
        'status': TicketStatus.open.name,
        'reportedById': actor.uid,
        'reportedByName': actor.name,
        'reportedByRole': actor.role.code,
        'roomId': draft.roomId,
        'roomNumber': draft.roomNumber,
        'area': draft.area,
        'photoPaths': photoPaths,
        'slaDueAt': ts(slaDueAt),
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      })
      ..set(ref.collection('events').doc(), {
        'type': TicketEventType.created.name,
        'toStatus': TicketStatus.open.name,
        'note': draft.description,
        'actor': actorJson(actor),
        'actorName': actor.name,
        'at': FieldValue.serverTimestamp(),
      });
    await batch.commit();
    return ref.id;
  });

  @override
  Future<void> changeStatus(
    String hotelId, {
    required MaintenanceTicket ticket,
    required TicketStatus to,
    required Actor actor,
    String? note,
  }) => guard(
    () => _db.runTransaction((tx) async {
      final ref = _db.doc('${FsPaths.tickets(hotelId)}/${ticket.id}');
      final snap = await tx.get(ref);
      if (snap.data()?.strOrNull('status') != ticket.status.name) {
        throw const ValidationFailure('ticket_status_changed');
      }
      tx
        ..update(ref, {
          'status': to.name,
          'updatedAt': FieldValue.serverTimestamp(),
          'updatedBy': actorJson(actor),
          if (to == TicketStatus.resolved) 'resolvedAt': FieldValue.serverTimestamp(),
          if (to == TicketStatus.resolved && note != null) 'resolutionNote': note,
        })
        ..set(ref.collection('events').doc(), {
          'type': TicketEventType.statusChanged.name,
          'fromStatus': ticket.status.name,
          'toStatus': to.name,
          'note': note,
          'actor': actorJson(actor),
          'actorName': actor.name,
          'at': FieldValue.serverTimestamp(),
        });
    }),
  );

  @override
  Future<void> assign(
    String hotelId, {
    required MaintenanceTicket ticket,
    required String assigneeId,
    required String assigneeName,
    required Actor actor,
  }) => guard(() async {
    final ref = _db.doc('${FsPaths.tickets(hotelId)}/${ticket.id}');
    final batch = _db.batch()
      ..update(ref, {
        'assigneeId': assigneeId,
        'assigneeName': assigneeName,
        if (ticket.status == TicketStatus.open) 'status': TicketStatus.assigned.name,
        'updatedAt': FieldValue.serverTimestamp(),
        'updatedBy': actorJson(actor),
      })
      ..set(ref.collection('events').doc(), {
        'type': TicketEventType.assigned.name,
        'note': assigneeName,
        'actor': actorJson(actor),
        'actorName': actor.name,
        'at': FieldValue.serverTimestamp(),
      });
    await batch.commit();
  });
}

// ------------------------------------------------------------------ energy

class FirestoreEnergyRepository implements EnergyRepository {
  FirestoreEnergyRepository(this._db);

  final FirebaseFirestore _db;

  @override
  Stream<List<EnergyReading>> watchReadings(
    String hotelId, {
    required DateTime from,
    required DateTime to,
  }) => _db
      .collection(FsPaths.energy(hotelId))
      .where('day', isGreaterThanOrEqualTo: DayKey.of(from))
      .where('day', isLessThanOrEqualTo: DayKey.of(to))
      .orderBy('day')
      .snapshots()
      .map(
        (s) => [
          for (final doc in s.docs)
            EnergyReading(
              id: doc.id,
              type: doc.data().enumValue('type', EnergyType.values, EnergyType.electricity),
              day: DayKey.parse(doc.data().str('day')),
              consumption: doc.data().dbl('consumption'),
              source: doc.data().enumValue('source', ReadingSource.values, ReadingSource.manual),
              recordedByName: doc.data().str('recordedByName'),
              createdAt: doc.data().dateOrNow('createdAt'),
              meterValue: doc.data().dblOrNull('meterValue'),
              cost: doc.data().dblOrNull('cost'),
              note: doc.data().strOrNull('note'),
            ),
        ],
      )
      .mapFailures();

  @override
  Future<void> saveReading(
    String hotelId,
    EnergyReadingDraft draft,
    Actor actor,
  ) => guard(() async {
    if (draft.consumption < 0) {
      throw const ValidationFailure('negative_consumption');
    }
    final day = DayKey.of(draft.day);
    await _db.doc('${FsPaths.energy(hotelId)}/${day}_${draft.type.name}').set({
      'type': draft.type.name,
      'unit': draft.type.unit,
      'day': day,
      'date': ts(DayKey.startOfDay(draft.day)),
      'consumption': draft.consumption,
      'meterValue': draft.meterValue,
      'cost': draft.cost,
      'note': draft.note,
      'source': ReadingSource.manual.name,
      'recordedBy': actorJson(actor),
      'recordedByName': actor.name,
      'createdAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  });
}

// -------------------------------------------------------------- operations

class FirestoreOperationsRepository implements OperationsRepository {
  FirestoreOperationsRepository(this._db);

  final FirebaseFirestore _db;

  @override
  Stream<List<DailyOperations>> watchRange(
    String hotelId, {
    required DateTime from,
    required DateTime to,
  }) => _db
      .collection(FsPaths.operations(hotelId))
      .where('day', isGreaterThanOrEqualTo: DayKey.of(from))
      .where('day', isLessThanOrEqualTo: DayKey.of(to))
      .orderBy('day')
      .snapshots()
      .map(
        (s) => [
          for (final doc in s.docs)
            DailyOperations(
              day: DayKey.parse(doc.data().str('day')),
              roomsAvailable: doc.data().integer('roomsAvailable'),
              roomsOccupied: doc.data().integer('roomsOccupied'),
              guests: doc.data().integer('guests'),
              roomRevenue: doc.data().dbl('roomRevenue'),
              fnbRevenue: doc.data().dbl('fnbRevenue'),
              otherRevenue: doc.data().dbl('otherRevenue'),
              updatedByName: doc.data().strOrNull('updatedByName'),
              updatedAt: doc.data().date('updatedAt'),
            ),
        ],
      )
      .mapFailures();

  @override
  Future<void> save(String hotelId, DailyOperations o, Actor actor) =>
      guard(() async {
        if (o.roomsOccupied > o.roomsAvailable) {
          throw const ValidationFailure('occupied_exceeds_available');
        }
        final day = DayKey.of(o.day);
        await _db.doc('${FsPaths.operations(hotelId)}/$day').set({
          'day': day,
          'date': ts(DayKey.startOfDay(o.day)),
          'roomsAvailable': o.roomsAvailable,
          'roomsOccupied': o.roomsOccupied,
          'guests': o.guests,
          'roomRevenue': o.roomRevenue,
          'fnbRevenue': o.fnbRevenue,
          'otherRevenue': o.otherRevenue,
          'source': 'manual',
          'updatedBy': actorJson(actor),
          'updatedByName': actor.name,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      });
}

// --------------------------------------------------------------- inventory

class FirestoreInventoryRepository implements InventoryRepository {
  FirestoreInventoryRepository(this._db);

  final FirebaseFirestore _db;

  static InventoryItem fromDoc(DocumentSnapshot<Json> doc) {
    final d = doc.data() ?? const {};
    return InventoryItem(
      id: doc.id,
      name: d.str('name'),
      sku: d.str('sku'),
      category: d.enumValue('category', InventoryCategory.values, InventoryCategory.other),
      unit: d.str('unit'),
      quantity: d.dbl('quantity'),
      reorderLevel: d.dbl('reorderLevel'),
      reorderQuantity: d.dbl('reorderQuantity'),
      location: d.strOrNull('location'),
      unitCost: d.dblOrNull('unitCost'),
      updatedAt: d.date('updatedAt'),
    );
  }

  @override
  Stream<List<InventoryItem>> watchItems(String hotelId) => _db
      .collection(FsPaths.items(hotelId))
      .orderBy('name')
      .snapshots()
      .map((s) => s.docs.map(fromDoc).toList())
      .mapFailures();

  @override
  Stream<InventoryItem?> watchItem(String hotelId, String itemId) => _db
      .doc('${FsPaths.items(hotelId)}/$itemId')
      .snapshots()
      .map((s) => s.exists ? fromDoc(s) : null)
      .mapFailures();

  @override
  Stream<List<StockMovement>> watchMovements(
    String hotelId, {
    String? itemId,
    int limit = 30,
  }) {
    Query<Json> q = _db.collection(FsPaths.movements(hotelId));
    if (itemId != null) q = q.where('itemId', isEqualTo: itemId);
    return q
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map(
          (s) => [
            for (final doc in s.docs)
              StockMovement(
                id: doc.id,
                itemId: doc.data().str('itemId'),
                itemName: doc.data().str('itemName'),
                type: doc.data().enumValue('type', MovementType.values, MovementType.adjust),
                delta: doc.data().dbl('delta'),
                quantityAfter: doc.data().dbl('quantityAfter'),
                actorName: doc.data().str('actorName'),
                createdAt: doc.data().dateOrNow('createdAt'),
                reason: doc.data().strOrNull('reason'),
              ),
          ],
        )
        .mapFailures();
  }

  /// Transaction: item quantity and movement ledger change together. Security
  /// rules verify (via `getAfter`) that the item's new quantity equals the
  /// previous quantity plus the movement's delta.
  @override
  Future<void> recordMovement(
    String hotelId, {
    required String itemId,
    required MovementType type,
    required double delta,
    required Actor actor,
    String? reason,
  }) => guard(
    () => _db.runTransaction((tx) async {
      final itemRef = _db.doc('${FsPaths.items(hotelId)}/$itemId');
      final snap = await tx.get(itemRef);
      if (!snap.exists) throw const NotFoundFailure('inventory_item');
      final before = snap.data()!.dbl('quantity');
      final after = before + delta;
      if (after < 0) throw const ValidationFailure('insufficient_stock');
      final movementRef = _db.collection(FsPaths.movements(hotelId)).doc();
      tx
        ..set(movementRef, {
          'itemId': itemId,
          'itemName': snap.data()!.str('name'),
          'type': type.name,
          'delta': delta,
          'quantityBefore': before,
          'quantityAfter': after,
          'reason': reason,
          'actor': actorJson(actor),
          'actorName': actor.name,
          'createdAt': FieldValue.serverTimestamp(),
        })
        ..update(itemRef, {
          'quantity': after,
          'lastMovementId': movementRef.id,
          'updatedAt': FieldValue.serverTimestamp(),
          'updatedBy': actorJson(actor),
        });
    }),
  );

  @override
  Future<String> createItem(
    String hotelId,
    InventoryItemDraft draft,
    Actor actor,
  ) => guard(() async {
    final ref = _db.collection(FsPaths.items(hotelId)).doc();
    await ref.set({
      'name': draft.name,
      'sku': draft.sku,
      'category': draft.category.name,
      'unit': draft.unit,
      'quantity': draft.initialQuantity,
      'reorderLevel': draft.reorderLevel,
      'reorderQuantity': draft.reorderQuantity,
      'location': draft.location,
      'unitCost': draft.unitCost,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
      'updatedBy': actorJson(actor),
    });
    return ref.id;
  });
}

// ------------------------------------------------------------------- staff

class FirestoreStaffRepository implements StaffRepository {
  FirestoreStaffRepository(this._db);

  final FirebaseFirestore _db;

  @override
  Stream<List<StaffMember>> watchStaff(String hotelId) => _db
      .collection(FsPaths.staff(hotelId))
      .where('active', isEqualTo: true)
      .snapshots()
      .map(
        (s) => [
          for (final doc in s.docs)
            StaffMember(
              id: doc.id,
              fullName: doc.data().str('fullName'),
              department: doc.data().enumValue('department', Department.values, Department.management),
              position: doc.data().str('position'),
              role: AppRole.fromCode(doc.data().strOrNull('role')),
              userId: doc.data().strOrNull('userId'),
              phone: doc.data().strOrNull('phone'),
            ),
        ]..sort((a, b) {
          final d = a.department.index.compareTo(b.department.index);
          return d != 0 ? d : a.fullName.compareTo(b.fullName);
        }),
      )
      .mapFailures();

  @override
  Stream<List<Shift>> watchShifts(
    String hotelId, {
    required DateTime day,
    String? userId,
  }) {
    Query<Json> q = _db
        .collection(FsPaths.shifts(hotelId))
        .where('day', isEqualTo: DayKey.of(day));
    if (userId != null) q = q.where('userId', isEqualTo: userId);
    return q
        .snapshots()
        .map(
          (s) => [
            for (final doc in s.docs)
              Shift(
                id: doc.id,
                staffId: doc.data().str('staffId'),
                staffName: doc.data().str('staffName'),
                department: doc.data().enumValue('department', Department.values, Department.management),
                day: DayKey.parse(doc.data().str('day')),
                type: doc.data().enumValue('type', ShiftType.values, ShiftType.morning),
                startTime: doc.data().str('startTime'),
                endTime: doc.data().str('endTime'),
                status: doc.data().enumValue('status', ShiftStatus.values, ShiftStatus.scheduled),
                userId: doc.data().strOrNull('userId'),
              ),
          ]..sort((a, b) {
            final t = a.type.index.compareTo(b.type.index);
            return t != 0 ? t : a.staffName.compareTo(b.staffName);
          }),
        )
        .mapFailures();
  }

  @override
  Future<void> createShift(String hotelId, ShiftDraft draft, Actor actor) =>
      guard(() async {
        final (start, end) = draft.hours;
        await _db.collection(FsPaths.shifts(hotelId)).add({
          'staffId': draft.staff.id,
          'staffName': draft.staff.fullName,
          'userId': draft.staff.userId,
          'department': draft.staff.department.name,
          'day': DayKey.of(draft.day),
          'date': ts(DayKey.startOfDay(draft.day)),
          'type': draft.type.name,
          'startTime': start,
          'endTime': end,
          'status': ShiftStatus.scheduled.name,
          'createdBy': actorJson(actor),
          'createdAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      });

  @override
  Future<void> updateShiftStatus(
    String hotelId, {
    required String shiftId,
    required ShiftStatus status,
    required Actor actor,
  }) => guard(
    () => _db.doc('${FsPaths.shifts(hotelId)}/$shiftId').update({
      'status': status.name,
      'updatedAt': FieldValue.serverTimestamp(),
      'updatedBy': actorJson(actor),
    }),
  );
}
