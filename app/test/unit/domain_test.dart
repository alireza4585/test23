import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/error/app_failure.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/core/utils/clock.dart';
import 'package:zarin_hooshmand/core/utils/day_key.dart';
import 'package:zarin_hooshmand/data/demo/demo_repositories.dart';
import 'package:zarin_hooshmand/features/dashboard/domain/dashboard_metrics.dart';
import 'package:zarin_hooshmand/features/energy/domain/energy_analytics.dart';
import 'package:zarin_hooshmand/features/energy/domain/energy_reading.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';
import 'package:zarin_hooshmand/features/housekeeping/domain/housekeeping_task.dart';
import 'package:zarin_hooshmand/features/housekeeping/domain/housekeeping_workflow.dart';
import 'package:zarin_hooshmand/features/inventory/domain/inventory_item.dart';
import 'package:zarin_hooshmand/features/maintenance/domain/maintenance_ticket.dart';
import 'package:zarin_hooshmand/features/maintenance/domain/ticket_workflow.dart';
import 'package:zarin_hooshmand/features/operations/domain/daily_operations.dart';
import 'package:zarin_hooshmand/features/rooms/domain/room.dart';
import 'package:zarin_hooshmand/features/rooms/domain/room_status_policy.dart';

import '../helpers/test_app.dart';

void main() {
  group('RoomStatusPolicy', () {
    test('housekeepers follow the cleaning workflow only', () {
      final hk = userWith(AppRole.housekeepingStaff);
      expect(RoomStatusPolicy.allowedTargets(hk, RoomStatus.vacantDirty), {RoomStatus.cleaningInProgress});
      expect(RoomStatusPolicy.allowedTargets(hk, RoomStatus.cleaningInProgress), {RoomStatus.vacantClean});
      expect(RoomStatusPolicy.allowedTargets(hk, RoomStatus.occupied), isEmpty);
    });

    test('reception checks guests in and out', () {
      final fo = userWith(AppRole.receptionStaff);
      expect(RoomStatusPolicy.canTransition(fo, RoomStatus.vacantClean, RoomStatus.occupied), isTrue);
      expect(RoomStatusPolicy.canTransition(fo, RoomStatus.occupied, RoomStatus.vacantDirty), isTrue);
      expect(RoomStatusPolicy.canTransition(fo, RoomStatus.vacantDirty, RoomStatus.vacantClean), isFalse);
    });

    test('rooms.manage may set any status', () {
      final gm = userWith(AppRole.generalManager);
      expect(RoomStatusPolicy.allowedTargets(gm, RoomStatus.occupied).length, RoomStatus.values.length - 1);
    });
  });

  group('TicketWorkflow', () {
    final ticket = MaintenanceTicket(
      id: 't',
      title: 'AC',
      description: '',
      category: TicketCategory.hvac,
      priority: TicketPriority.high,
      status: TicketStatus.assigned,
      reportedById: 'x',
      reportedByName: 'x',
      createdAt: DateTime(2026, 10, 5, 8),
      slaDueAt: DateTime(2026, 10, 5, 16),
      assigneeId: 'u',
    );

    test('technicians can only progress tickets assigned to them', () {
      final tech = userWith(AppRole.maintenanceStaff); // uid 'u'
      expect(TicketWorkflow.allowedTargets(tech, ticket), {TicketStatus.inProgress});
      final other = MaintenanceTicket(
        id: 't2',
        title: 'x',
        description: '',
        category: TicketCategory.hvac,
        priority: TicketPriority.high,
        status: TicketStatus.assigned,
        reportedById: 'x',
        reportedByName: 'x',
        createdAt: ticket.createdAt,
        slaDueAt: ticket.slaDueAt,
        assigneeId: 'someone-else',
      );
      expect(TicketWorkflow.allowedTargets(tech, other), isEmpty);
    });

    test('SLA comes from hotel settings', () {
      final due = TicketWorkflow.slaDueAt(TicketPriority.critical, DateTime(2026, 1, 1, 10), const HotelSettings());
      expect(due, DateTime(2026, 1, 1, 12));
    });

    test('overdue detection', () {
      expect(ticket.isOverdue(DateTime(2026, 10, 5, 17)), isTrue);
      expect(ticket.isOverdue(DateTime(2026, 10, 5, 9)), isFalse);
    });
  });

  group('EnergyAnalytics', () {
    final from = DateTime(2026, 9, 1);
    final readings = [
      for (var d = 0; d < 10; d++)
        EnergyReading(
          id: '$d',
          type: EnergyType.electricity,
          day: from.add(Duration(days: d)),
          consumption: d >= 8 ? 3000 : 2000,
          source: ReadingSource.manual,
          recordedByName: 'x',
          createdAt: from,
        ),
    ];
    final ops = [
      for (var d = 0; d < 10; d++)
        DailyOperations(
          day: from.add(Duration(days: d)),
          roomsAvailable: 50,
          roomsOccupied: 40,
          guests: 60,
          roomRevenue: 1,
        ),
    ];

    test('totals, baseline deviation, anomalies and intensity', () {
      final s = EnergyAnalytics.summarize(
        type: EnergyType.electricity,
        readings: readings,
        from: from,
        to: from.add(const Duration(days: 9)),
        baseline: 2000,
        alertThresholdPct: 15,
        tariff: 10,
        operations: ops,
      );
      expect(s.total, 22000);
      expect(s.dailyAverage, 2200);
      expect(s.vsBaselinePct, closeTo(10, 0.001));
      expect(s.anomalies.length, 2);
      expect(s.perOccupiedRoom, closeTo(22000 / 400, 0.001));
      expect(s.estimatedCost, 220000);
    });
  });

  group('DailyOperations KPIs', () {
    test('occupancy, ADR and RevPAR', () {
      final o = DailyOperations(
        day: DateTime(2026),
        roomsAvailable: 50,
        roomsOccupied: 40,
        guests: 70,
        roomRevenue: 4000,
      );
      expect(o.occupancyRate, 80);
      expect(o.adr, 100);
      expect(o.revpar, 80);
    });
  });

  group('HousekeepingWorkflow (demo backend)', () {
    test('completing a checkout clean releases the room atomically', () async {
      final store = seededStore();
      final repo = DemoHousekeepingRepository(store);
      final workflow = HousekeepingWorkflow(repo, clock: FixedClock(testNow));
      // t-4: room 204, pending, assigned to u-hk-1.
      final task = store.tasks.get('t-4')!;
      final user = userWith(AppRole.housekeepingStaff, uid: 'u-hk-1');

      await workflow.start(hotelId: 'h', task: task, user: user, currentRoomStatus: RoomStatus.vacantDirty);
      expect(store.rooms.get('room-204')!.status, RoomStatus.cleaningInProgress);

      final started = store.tasks.get('t-4')!;
      expect(started.status, TaskStatus.inProgress);
      await workflow.complete(
        hotelId: 'h',
        task: started,
        user: user,
        currentRoomStatus: RoomStatus.cleaningInProgress,
      );
      expect(store.rooms.get('room-204')!.status, RoomStatus.vacantClean);
      expect(store.tasks.get('t-4')!.status, TaskStatus.done);
    });

    test("staff cannot work someone else's task", () async {
      final store = seededStore();
      final workflow = HousekeepingWorkflow(DemoHousekeepingRepository(store));
      final task = store.tasks.get('t-7')!; // assigned to u-hk-2
      final user = userWith(AppRole.housekeepingStaff, uid: 'u-hk-1');
      expect(
        () => workflow.start(hotelId: 'h', task: task, user: user, currentRoomStatus: RoomStatus.vacantDirty),
        throwsA(isA<PermissionDeniedFailure>()),
      );
    });
  });

  group('Inventory (demo backend)', () {
    test('stock can never go negative', () async {
      final store = seededStore();
      final repo = DemoInventoryRepository(store);
      final actor = userWith(AppRole.inventoryManager).asActor;
      await expectLater(
        repo.recordMovement('h', itemId: 'inv-11', type: MovementType.issue, delta: -10, actor: actor),
        throwsA(isA<ValidationFailure>()),
      );
      await repo.recordMovement('h', itemId: 'inv-11', type: MovementType.receive, delta: 12, actor: actor);
      expect(store.items.get('inv-11')!.quantity, 15);
      expect(store.movements.all.length, 1);
    });

    test('dropping below reorder level raises a low-stock alert', () async {
      final store = seededStore();
      final before = store.alerts.all.length;
      final repo = DemoInventoryRepository(store);
      await repo.recordMovement(
        'h',
        itemId: 'inv-2',
        type: MovementType.issue,
        delta: -300,
        actor: userWith(AppRole.inventoryManager).asActor,
      );
      expect(store.alerts.all.length, before + 1);
    });
  });

  group('DashboardMetrics', () {
    test('computes live KPIs from the seeded hotel', () {
      final store = seededStore();
      final m = DashboardMetrics.compute(
        now: testNow,
        settings: const HotelSettings(),
        rooms: store.rooms.all.toList(),
        operations: store.operations.all.toList(),
        energy: store.energy.all.toList(),
        tickets: store.tickets.all.toList(),
        tasks: store.tasks.all.toList(),
        shifts: store.shifts.all.toList(),
        inventory: store.items.all.toList(),
      );
      expect(m.roomsByStatus.values.fold<int>(0, (a, b) => a + b), 60);
      expect(m.roomsByStatus[RoomStatus.outOfOrder], 2);
      expect(m.liveOccupancyPct, closeTo(41 / 58 * 100, 0.01));
      expect(m.yesterday, isNotNull);
      expect(m.electricityTrend.length, 14);
      // Seeded story: electricity runs ~20% above baseline in the last days.
      expect(m.electricityVsBaselinePct, greaterThan(15));
      expect(m.openTickets, 5);
      expect(m.lowStockCount, greaterThan(0));
      expect(DayKey.of(m.occupancyTrend.last.day), '2026-10-04');
    });
  });
}
