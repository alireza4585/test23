import 'dart:math';

import '../../core/security/app_role.dart';
import '../../core/utils/day_key.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/energy/domain/energy_reading.dart';
import '../../features/hotel/domain/hotel.dart';
import '../../features/housekeeping/domain/housekeeping_task.dart';
import '../../features/inventory/domain/inventory_item.dart';
import '../../features/maintenance/domain/maintenance_ticket.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/operations/domain/daily_operations.dart';
import '../../features/rooms/domain/room.dart';
import '../../features/staff/domain/staff.dart';
import 'demo_collection.dart';
import 'demo_store.dart';

/// Builds a coherent, realistic dataset for "هتل بزرگ زرین" (60 rooms,
/// 45 days of history) relative to [now]. Deterministic (seeded RNG) so demos
/// and tests are reproducible.
///
/// The data tells a story the analytics and AI layer can discover:
/// electricity has run ~20% above baseline for the last four days while the
/// floor-4 chiller has open tickets, guest amenities are close to stock-out,
/// and checkout cleans are running longer than target.
class DemoSeed {
  DemoSeed(this.store, this.now) : _rng = Random(42);

  static const hotelId = 'zarin-grand-tehran';
  static const demoPassword = 'Zarin@2026';

  final DemoStore store;
  final DateTime now;
  final Random _rng;

  DateTime get today => DayKey.startOfDay(now);

  void populate() {
    store.hotels.put(
      const Hotel(
        id: hotelId,
        name: 'هتل بزرگ زرین',
        city: 'تهران',
        stars: 5,
        roomCount: 60,
      ),
    );
    _accounts();
    _staff();
    _rooms();
    final ops = _operations();
    _energy(ops);
    _tasks();
    _tickets();
    _inventory();
    _shifts();
    _alerts();
    _insights();
    _inbox();
  }

  // ---------------------------------------------------------------- accounts

  static const accounts = <(String, String, AppRole, String)>[
    ('u-gm', '0012345679', AppRole.generalManager, 'آرش کیانی'),
    ('u-owner', '0023456787', AppRole.hotelOwner, 'نسرین تهرانی'),
    ('u-ops', '0034567895', AppRole.operationsManager, 'بهرام صادقی'),
    ('u-energy', '0045678911', AppRole.energyManager, 'مریم فرهمند'),
    ('u-mnt-mgr', '0056789122', AppRole.maintenanceManager, 'رضا اکبری'),
    ('u-hk-mgr', '0067891233', AppRole.housekeepingManager, 'لیلا محمدی'),
    ('u-inv', '0078912342', AppRole.inventoryManager, 'حمید نوروزی'),
    ('u-hr', '0089123451', AppRole.hrManager, 'سارا رضایی'),
    ('u-reception', '0091234565', AppRole.receptionStaff, 'نیما جعفری'),
    ('u-hk-1', '0102345678', AppRole.housekeepingStaff, 'فاطمه حسینی'),
    ('u-hk-2', '0113456786', AppRole.housekeepingStaff, 'زهرا کریمی'),
    ('u-mnt-1', '0124567894', AppRole.maintenanceStaff, 'علی موسوی'),
    ('u-fnb-mgr', '0135678919', AppRole.restaurantManager, 'کامران شریفی'),
    ('u-fnb-1', '0168912341', AppRole.restaurantStaff, 'مهدی قاسمی'),
    ('u-analyst', '0146789121', AppRole.analyst, 'الهام نادری'),
    ('u-admin', '0157891232', AppRole.superAdmin, 'مدیر سامانه زرین'),
  ];

  void _accounts() {
    for (final (uid, nid, role, name) in accounts) {
      store.accountsByNationalId[nid] = DemoAccount(
        uid: uid,
        nationalId: nid,
        password: demoPassword,
        fullName: name,
        role: role,
        staffId: 's-$uid',
        phone: '0912${nid.substring(3, 10)}',
        lastLoginAt: now.subtract(Duration(hours: 2 + _rng.nextInt(40))),
      );
    }
  }

  void _staff() {
    final members = [
      for (final (uid, _, role, name) in accounts)
        if (role != AppRole.superAdmin && role != AppRole.hotelOwner)
          StaffMember(
            id: 's-$uid',
            fullName: name,
            department: role.department,
            position: role.code,
            role: role,
            userId: uid,
            phone: '0912${_rng.nextInt(9000000) + 1000000}',
          ),
      // Employees without app accounts (still rostered).
      const StaffMember(
        id: 's-hk-3',
        fullName: 'معصومه رحیمی',
        department: Department.housekeeping,
        position: 'housekeepingStaff',
      ),
      const StaffMember(
        id: 's-mnt-2',
        fullName: 'جواد طاهری',
        department: Department.maintenance,
        position: 'maintenanceStaff',
      ),
      const StaffMember(
        id: 's-fo-2',
        fullName: 'پریسا امینی',
        department: Department.frontOffice,
        position: 'receptionStaff',
      ),
    ];
    store.staff.putAll(members);
  }

  // ------------------------------------------------------------------- rooms

  void _rooms() {
    final rooms = <Room>[];
    const outOfOrder = {'405', '609'};
    const dirty = {'102', '107', '204', '209', '303', '310', '506', '601'};
    const cleaning = {'205', '402'};
    const clean = {'101', '110', '208', '307', '409', '503', '608'};
    for (var floor = 1; floor <= 6; floor++) {
      for (var i = 1; i <= 10; i++) {
        final number = '$floor${i.toString().padLeft(2, '0')}';
        final type = switch (floor) {
          6 => RoomType.suite,
          5 => RoomType.deluxe,
          _ => i <= 2 ? RoomType.single : (i.isEven ? RoomType.twin : RoomType.double),
        };
        final status = outOfOrder.contains(number)
            ? RoomStatus.outOfOrder
            : dirty.contains(number)
            ? RoomStatus.vacantDirty
            : cleaning.contains(number)
            ? RoomStatus.cleaningInProgress
            : clean.contains(number)
            ? RoomStatus.vacantClean
            : RoomStatus.occupied;
        rooms.add(
          Room(
            id: 'room-$number',
            number: number,
            floor: floor,
            type: type,
            status: status,
            updatedAt: now.subtract(Duration(minutes: 10 + _rng.nextInt(600))),
            updatedByName: 'لیلا محمدی',
            note: number == '405' ? 'نشتی آب از سقف — در انتظار تعمیر' : null,
          ),
        );
      }
    }
    store.rooms.putAll(rooms);
  }

  // -------------------------------------------------------------- operations

  List<DailyOperations> _operations() {
    final list = <DailyOperations>[];
    for (var back = 44; back >= 0; back--) {
      final day = today.subtract(Duration(days: back));
      final weekend = day.weekday == DateTime.thursday || day.weekday == DateTime.friday;
      final occupied = (weekend ? 50 : 41) + _rng.nextInt(7) - 3;
      const adr = 85000000.0;
      final rate = adr * (0.92 + _rng.nextDouble() * 0.16);
      list.add(
        DailyOperations(
          day: day,
          roomsAvailable: 58,
          roomsOccupied: occupied.clamp(0, 58),
          guests: (occupied * 1.7).round(),
          roomRevenue: (occupied * rate).roundToDouble(),
          fnbRevenue: (occupied * rate * 0.28).roundToDouble(),
          otherRevenue: (occupied * rate * 0.06).roundToDouble(),
          updatedByName: 'نیما جعفری',
          updatedAt: day.add(const Duration(hours: 23)),
        ),
      );
    }
    store.operations.putAll(list);
    return list;
  }

  // ------------------------------------------------------------------ energy

  void _energy(List<DailyOperations> ops) {
    final readings = <EnergyReading>[];
    for (final o in ops) {
      final back = today.difference(o.day).inDays;
      if (back == 0) continue; // today's reading not entered yet
      final spike = back <= 4 ? 1.21 + _rng.nextDouble() * 0.05 : 1.0;
      final electricity =
          (1500 + 18.5 * o.roomsOccupied + _noise(90)) * spike;
      final water = 12 + 0.6 * o.roomsOccupied + _noise(2.5);
      final gas = 190 + 2.4 * o.roomsOccupied + _noise(18);
      for (final (type, value) in [
        (EnergyType.electricity, electricity),
        (EnergyType.water, water),
        (EnergyType.gas, gas),
      ]) {
        readings.add(
          EnergyReading(
            id: '${DayKey.of(o.day)}_${type.name}',
            type: type,
            day: o.day,
            consumption: double.parse(value.toStringAsFixed(1)),
            source: ReadingSource.manual,
            recordedByName: 'مریم فرهمند',
            createdAt: o.day.add(const Duration(hours: 23, minutes: 30)),
          ),
        );
      }
    }
    store.energy.putAll(readings);
  }

  double _noise(double amplitude) => (_rng.nextDouble() * 2 - 1) * amplitude;

  // ------------------------------------------------------------ housekeeping

  void _tasks() {
    final t = today;
    HousekeepingTask task(
      String id,
      String room,
      HousekeepingTaskType type,
      TaskStatus status, {
      String assignee = 'u-hk-1',
      TaskPriority priority = TaskPriority.normal,
      int startedMinutesAgo = 0,
      int duration = 0,
      int dueHour = 14,
    }) {
      final name = assignee == 'u-hk-1' ? 'فاطمه حسینی' : 'زهرا کریمی';
      final started = startedMinutesAgo > 0
          ? now.subtract(Duration(minutes: startedMinutesAgo))
          : null;
      return HousekeepingTask(
        id: id,
        roomId: 'room-$room',
        roomNumber: room,
        type: type,
        status: status,
        priority: priority,
        createdAt: t.add(const Duration(hours: 7)),
        assigneeId: assignee,
        assigneeName: name,
        dueAt: t.add(Duration(hours: dueHour)),
        startedAt: started,
        completedAt: status == TaskStatus.done && started != null
            ? started.add(Duration(minutes: duration))
            : null,
        createdByName: 'لیلا محمدی',
      );
    }

    store.tasks.putAll([
      task('t-1', '101', HousekeepingTaskType.checkoutClean, TaskStatus.done,
          startedMinutesAgo: 190, duration: 42),
      task('t-2', '110', HousekeepingTaskType.checkoutClean, TaskStatus.done,
          startedMinutesAgo: 140, duration: 39),
      task('t-3', '205', HousekeepingTaskType.checkoutClean, TaskStatus.inProgress,
          startedMinutesAgo: 18, priority: TaskPriority.high),
      task('t-4', '204', HousekeepingTaskType.checkoutClean, TaskStatus.pending,
          priority: TaskPriority.urgent, dueHour: 12),
      task('t-5', '209', HousekeepingTaskType.checkoutClean, TaskStatus.pending),
      task('t-6', '206', HousekeepingTaskType.stayoverClean, TaskStatus.pending,
          priority: TaskPriority.low, dueHour: 16),
      task('t-7', '303', HousekeepingTaskType.checkoutClean, TaskStatus.pending,
          assignee: 'u-hk-2'),
      task('t-8', '310', HousekeepingTaskType.checkoutClean, TaskStatus.pending,
          assignee: 'u-hk-2'),
      task('t-9', '402', HousekeepingTaskType.deepClean, TaskStatus.inProgress,
          assignee: 'u-hk-2', startedMinutesAgo: 55),
      task('t-10', '307', HousekeepingTaskType.inspection, TaskStatus.done,
          assignee: 'u-hk-2', startedMinutesAgo: 120, duration: 9),
      task('t-11', '506', HousekeepingTaskType.checkoutClean, TaskStatus.pending,
          assignee: 'u-hk-2', priority: TaskPriority.high),
      task('t-12', '601', HousekeepingTaskType.checkoutClean, TaskStatus.pending,
          assignee: 'u-hk-2', dueHour: 15),
    ]);
  }

  // ------------------------------------------------------------- maintenance

  void _tickets() {
    MaintenanceTicket ticket(
      String id,
      String title,
      String description,
      TicketCategory category,
      TicketPriority priority,
      TicketStatus status, {
      String? room,
      String? area,
      int hoursAgo = 3,
      int slaHours = 24,
      String? assignee,
      String reporter = 'u-hk-1',
      int? resolvedAfterHours,
    }) {
      final created = now.subtract(Duration(hours: hoursAgo));
      final reporterAccount = store.accountByUid(reporter);
      final assigneeAccount = assignee == null ? null : store.accountByUid(assignee);
      return MaintenanceTicket(
        id: id,
        title: title,
        description: description,
        category: category,
        priority: priority,
        status: status,
        reportedById: reporter,
        reportedByName: reporterAccount?.fullName ?? '—',
        createdAt: created,
        updatedAt: created.add(const Duration(minutes: 20)),
        slaDueAt: created.add(Duration(hours: slaHours)),
        roomId: room == null ? null : 'room-$room',
        roomNumber: room,
        area: area,
        assigneeId: assignee,
        assigneeName: assigneeAccount?.fullName,
        resolvedAt: resolvedAfterHours == null
            ? null
            : created.add(Duration(hours: resolvedAfterHours)),
        resolutionNote: resolvedAfterHours == null ? null : 'تعویض قطعه و تست نهایی انجام شد.',
      );
    }

    final tickets = [
      ticket('mt-1', 'نشتی آب از سقف حمام', 'آب از سقف حمام اتاق ۴۰۵ چکه می‌کند؛ احتمالاً از لوله طبقه بالا.',
          TicketCategory.plumbing, TicketPriority.critical, TicketStatus.inProgress,
          room: '405', hoursAgo: 5, slaHours: 2, assignee: 'u-mnt-1'),
      ticket('mt-2', 'صدای غیرعادی و افت راندمان چیلر طبقه ۴', 'از چهار روز پیش چیلر طبقه ۴ با صدای غیرعادی کار می‌کند و دمای راهروها بالاست.',
          TicketCategory.hvac, TicketPriority.high, TicketStatus.open,
          area: 'موتورخانه — چیلر ۲', hoursAgo: 30, slaHours: 8, reporter: 'u-energy'),
      ticket('mt-3', 'قفل کارتی اتاق ۵۰۲ کارت را نمی‌خواند', 'مهمان دو بار پشت در مانده است.',
          TicketCategory.appliance, TicketPriority.medium, TicketStatus.assigned,
          room: '502', hoursAgo: 4, assignee: 'u-mnt-1', reporter: 'u-reception'),
      ticket('mt-4', 'تلویزیون اتاق ۲۰۳ روشن نمی‌شود', 'ریموت و برق بررسی شد.',
          TicketCategory.appliance, TicketPriority.low, TicketStatus.resolved,
          room: '203', hoursAgo: 26, slaHours: 72, assignee: 'u-mnt-1', resolvedAfterHours: 6),
      ticket('mt-5', 'لامپ‌های راهروی طبقه ۳ سوخته', 'سه لامپ سقفی خاموش است.',
          TicketCategory.electrical, TicketPriority.medium, TicketStatus.open,
          area: 'راهروی طبقه ۳', hoursAgo: 28, slaHours: 24),
      ticket('mt-6', 'فن کویل اتاق ۶۰۹ آب می‌دهد', 'زیر فن کویل خیس است و موکت آسیب دیده.',
          TicketCategory.hvac, TicketPriority.high, TicketStatus.onHold,
          room: '609', hoursAgo: 50, slaHours: 8, assignee: 'u-mnt-1', reporter: 'u-hk-2'),
      ticket('mt-7', 'چکه کردن شیر آشپزخانه رستوران', 'شیر سینک شماره ۲.',
          TicketCategory.plumbing, TicketPriority.low, TicketStatus.closed,
          area: 'آشپزخانه رستوران', hoursAgo: 120, slaHours: 72, assignee: 'u-mnt-1',
          reporter: 'u-fnb-1', resolvedAfterHours: 20),
      ticket('mt-8', 'تعویض فیلتر هواساز لابی', 'سرویس دوره‌ای.',
          TicketCategory.hvac, TicketPriority.medium, TicketStatus.resolved,
          area: 'لابی', hoursAgo: 75, assignee: 'u-mnt-1', reporter: 'u-mnt-mgr', resolvedAfterHours: 10),
    ];
    store.tickets.putAll(tickets);

    for (final t in tickets) {
      store.ticketEvents.put(
        Scoped(t.id, '${t.id}-e1', TicketEvent(
          id: '${t.id}-e1',
          type: TicketEventType.created,
          actorName: t.reportedByName,
          at: t.createdAt,
          toStatus: TicketStatus.open,
          note: t.description,
        )),
      );
      if (t.assigneeName != null) {
        store.ticketEvents.put(
          Scoped(t.id, '${t.id}-e2', TicketEvent(
            id: '${t.id}-e2',
            type: TicketEventType.assigned,
            actorName: 'رضا اکبری',
            at: t.createdAt.add(const Duration(minutes: 15)),
            note: t.assigneeName,
          )),
        );
      }
      if (t.status != TicketStatus.open && t.status != TicketStatus.assigned) {
        store.ticketEvents.put(
          Scoped(t.id, '${t.id}-e3', TicketEvent(
            id: '${t.id}-e3',
            type: TicketEventType.statusChanged,
            actorName: t.assigneeName ?? 'رضا اکبری',
            at: t.updatedAt ?? t.createdAt,
            fromStatus: TicketStatus.assigned,
            toStatus: t.status,
            note: t.resolutionNote,
          )),
        );
      }
    }
  }

  // --------------------------------------------------------------- inventory

  void _inventory() {
    InventoryItem item(
      String id,
      String name,
      String sku,
      InventoryCategory category,
      String unit,
      double qty,
      double reorder,
      double cost, {
      String location = 'انبار مرکزی',
    }) => InventoryItem(
      id: id,
      name: name,
      sku: sku,
      category: category,
      unit: unit,
      quantity: qty,
      reorderLevel: reorder,
      reorderQuantity: reorder * 3,
      location: location,
      unitCost: cost,
      updatedAt: now.subtract(Duration(hours: _rng.nextInt(72))),
    );

    store.items.putAll([
      item('inv-1', 'شامپو مهمان ۳۰ میلی‌لیتری', 'AM-SH30', InventoryCategory.guestAmenities, 'عدد', 140, 200, 85000),
      item('inv-2', 'صابون مهمان', 'AM-SP25', InventoryCategory.guestAmenities, 'عدد', 520, 250, 52000),
      item('inv-3', 'مسواک و خمیردندان', 'AM-TB01', InventoryCategory.guestAmenities, 'بسته', 95, 120, 110000),
      item('inv-4', 'حوله حمام', 'LN-BT70', InventoryCategory.linen, 'عدد', 410, 180, 1450000, location: 'لاندری'),
      item('inv-5', 'ملحفه دونفره', 'LN-SH-D', InventoryCategory.linen, 'عدد', 260, 150, 2100000, location: 'لاندری'),
      item('inv-6', 'مایع شوینده سطوح', 'CL-SR5', InventoryCategory.cleaningSupplies, 'گالن', 18, 10, 950000),
      item('inv-7', 'کیسه زباله بزرگ', 'CL-BG90', InventoryCategory.cleaningSupplies, 'بسته', 7, 12, 320000),
      item('inv-8', 'قهوه اسپرسو', 'FB-ESP1', InventoryCategory.foodAndBeverage, 'کیلوگرم', 22, 15, 6800000, location: 'انبار رستوران'),
      item('inv-9', 'چای کیسه‌ای', 'FB-TEA', InventoryCategory.foodAndBeverage, 'جعبه', 40, 20, 450000, location: 'انبار رستوران'),
      item('inv-10', 'لامپ LED ۹ وات', 'MP-LED9', InventoryCategory.maintenanceParts, 'عدد', 34, 25, 180000, location: 'انبار فنی'),
      item('inv-11', 'فیلتر هواساز G4', 'MP-FG4', InventoryCategory.maintenanceParts, 'عدد', 3, 6, 2400000, location: 'انبار فنی'),
      item('inv-12', 'باتری قفل کارتی AA', 'MP-BAA', InventoryCategory.maintenanceParts, 'عدد', 120, 60, 65000, location: 'انبار فنی'),
      item('inv-13', 'کاغذ A4', 'OF-A4', InventoryCategory.office, 'بسته', 30, 10, 380000),
    ]);
  }

  // ------------------------------------------------------------------ shifts

  void _shifts() {
    final shifts = <Shift>[];
    var index = 0;
    for (final member in store.staff.all) {
      // Demo accounts work the day shift (so they are "on duty" in demos);
      // the rest of the roster covers evening / night.
      final type = member.userId != null && member.department != Department.foodAndBeverage
          ? ShiftType.morning
          : (index.isEven ? ShiftType.evening : ShiftType.night);
      final hours = ShiftDraft(staff: member, day: today, type: type).hours;
      final status = type == ShiftType.morning ? ShiftStatus.checkedIn : ShiftStatus.scheduled;
      for (final dayOffset in [0, 1]) {
        shifts.add(
          Shift(
            id: 'sh-${member.id}-$dayOffset',
            staffId: member.id,
            staffName: member.fullName,
            department: member.department,
            day: today.add(Duration(days: dayOffset)),
            type: type,
            startTime: hours.$1,
            endTime: hours.$2,
            status: dayOffset == 0 ? status : ShiftStatus.scheduled,
            userId: member.userId,
          ),
        );
      }
      index++;
    }
    store.shifts.putAll(shifts);
  }

  // ------------------------------------------------------- alerts & insights

  void _alerts() {
    store.alerts.putAll([
      HotelAlert(
        id: 'al-1',
        type: AlertType.energySpike,
        severity: AlertSeverity.critical,
        title: 'افزایش غیرعادی مصرف برق',
        message: 'مصرف برق دیروز ۲۲٪ بالاتر از خط مبنا بود (چهارمین روز متوالی).',
        status: AlertStatus.open,
        createdAt: now.subtract(const Duration(hours: 9)),
        route: '/energy',
      ),
      HotelAlert(
        id: 'al-2',
        type: AlertType.lowStock,
        severity: AlertSeverity.warning,
        title: 'کمبود موجودی: شامپو مهمان',
        message: 'موجودی ۱۴۰ عدد، کمتر از نقطه سفارش (۲۰۰).',
        status: AlertStatus.open,
        createdAt: now.subtract(const Duration(hours: 6)),
        route: '/inventory/inv-1',
      ),
      HotelAlert(
        id: 'al-3',
        type: AlertType.maintenanceSla,
        severity: AlertSeverity.warning,
        title: 'عبور از SLA: چیلر طبقه ۴',
        message: 'تیکت با اولویت بالا بیش از ۲۴ ساعت بدون تکنسین مانده است.',
        status: AlertStatus.open,
        createdAt: now.subtract(const Duration(hours: 3)),
        route: '/maintenance/mt-2',
      ),
      HotelAlert(
        id: 'al-4',
        type: AlertType.criticalTicket,
        severity: AlertSeverity.critical,
        title: 'خرابی بحرانی: نشتی آب اتاق ۴۰۵',
        message: 'اتاق از سرویس خارج شد. تکنسین: علی موسوی.',
        status: AlertStatus.acknowledged,
        acknowledgedByName: 'رضا اکبری',
        createdAt: now.subtract(const Duration(hours: 5)),
        route: '/maintenance/mt-1',
      ),
    ]);
  }

  void _insights() {
    store.insights.putAll([
      AiInsight(
        id: 'ai-1',
        category: InsightCategory.energy,
        title: 'افزایش ۲۱٪ مصرف برق؛ احتمال افت راندمان چیلر طبقه ۴',
        summary:
            'در ۴ روز اخیر مصرف برق به ازای هر اتاق اشغال‌شده از ۵۴ به ۶۶ کیلووات‌ساعت رسیده، در حالی که نرخ اشغال تغییری نکرده است. هم‌زمان تیکت «صدای غیرعادی چیلر طبقه ۴» باز است.',
        recommendation:
            'سرویس فوری چیلر ۲ (بررسی مبرد و کندانسور) و تنظیم نقطه کار سرمایش اتاق‌های خالی روی ۲۶ درجه.',
        confidence: 0.82,
        status: InsightStatus.active,
        source: 'ruleEngine',
        createdAt: now.subtract(const Duration(hours: 8)),
        estimatedMonthlySaving: 52000000,
        evidence: const [
          'برق: میانگین ۴ روز اخیر ≈ ۲۹۰۰ kWh در برابر خط مبنای ۲۴۰۰ kWh',
          'نرخ اشغال: بدون تغییر معنادار (±۳٪)',
          'تیکت باز mt-2 — HVAC — اولویت بالا',
        ],
        route: '/energy',
      ),
      AiInsight(
        id: 'ai-2',
        category: InsightCategory.inventory,
        title: 'پیش‌بینی اتمام شامپو مهمان تا ۳ روز آینده',
        summary: 'مصرف روزانه شامپو حدود ۴۵ عدد است و موجودی فعلی ۱۴۰ عدد.',
        recommendation: 'ثبت سفارش ۶۰۰ عددی امروز (مقدار سفارش اقتصادی).',
        confidence: 0.9,
        status: InsightStatus.active,
        source: 'ruleEngine',
        createdAt: now.subtract(const Duration(hours: 6)),
        evidence: const ['موجودی: ۱۴۰', 'نقطه سفارش: ۲۰۰', 'میانگین مصرف ۷ روز: ۴۵/روز'],
        route: '/inventory/inv-1',
      ),
      AiInsight(
        id: 'ai-3',
        category: InsightCategory.housekeeping,
        title: 'زمان نظافت اتاق‌های تخلیه ۱۸٪ بیش از هدف',
        summary: 'میانگین زمان نظافت checkout امروز ۴۰ دقیقه در برابر هدف ۳۵ دقیقه است.',
        recommendation:
            'آماده‌سازی ترولی‌ها پیش از شروع شیفت و تخصیص اتاق‌ها بر اساس طبقه برای کاهش جابه‌جایی.',
        confidence: 0.71,
        status: InsightStatus.active,
        source: 'ruleEngine',
        createdAt: now.subtract(const Duration(hours: 2)),
        evidence: const ['تکمیل‌شده امروز: ۲ اتاق checkout', 'میانگین: ۴۰.۵ دقیقه', 'هدف: ۳۵ دقیقه'],
        route: '/housekeeping',
      ),
      AiInsight(
        id: 'ai-4',
        category: InsightCategory.maintenance,
        title: 'نگهداری پیشگیرانه سیستم HVAC',
        summary: '۳ تیکت HVAC در ۳۰ روز اخیر ثبت شده که ۲ مورد مربوط به فن‌کویل‌ها و چیلر است.',
        recommendation: 'برنامه سرویس فصلی فن‌کویل‌ها پیش از اوج تابستان؛ کاهش تیکت‌های اضطراری.',
        confidence: 0.64,
        status: InsightStatus.active,
        source: 'ruleEngine',
        createdAt: now.subtract(const Duration(days: 1)),
        estimatedMonthlySaving: 18000000,
        route: '/maintenance',
      ),
    ]);
  }

  void _inbox() {
    void send(String uid, String id, String title, String body, NotificationCategory category,
        AlertSeverity severity, int hoursAgo, {String? route, bool read = false}) {
      final created = now.subtract(Duration(hours: hoursAgo));
      store.inbox.put(
        Scoped(uid, '$uid-$id', InboxNotification(
          id: '$uid-$id',
          title: title,
          body: body,
          category: category,
          severity: severity,
          createdAt: created,
          route: route,
          readAt: read ? created.add(const Duration(minutes: 30)) : null,
        )),
      );
    }

    for (final uid in ['u-gm', 'u-owner', 'u-ops', 'u-energy', 'u-analyst']) {
      send(uid, 'n1', 'افزایش غیرعادی مصرف برق', 'مصرف برق ۲۲٪ بالاتر از خط مبنا.',
          NotificationCategory.alert, AlertSeverity.critical, 9, route: '/energy');
    }
    for (final uid in ['u-gm', 'u-mnt-mgr', 'u-ops']) {
      send(uid, 'n2', 'خرابی بحرانی در اتاق ۴۰۵', 'نشتی آب — اتاق از سرویس خارج شد.',
          NotificationCategory.maintenance, AlertSeverity.critical, 5, route: '/maintenance/mt-1');
    }
    send('u-mnt-1', 'n3', 'تیکت جدید به شما ارجاع شد', 'قفل کارتی اتاق ۵۰۲',
        NotificationCategory.maintenance, AlertSeverity.warning, 4, route: '/maintenance/mt-3');
    send('u-hk-1', 'n4', 'اتاق فوری برای نظافت', 'اتاق ۲۰۴ تا ساعت ۱۲ باید آماده شود.',
        NotificationCategory.task, AlertSeverity.warning, 1, route: '/housekeeping');
    send('u-hk-1', 'n5', 'برنامه شیفت فردا', 'شیفت صبح ۰۷:۰۰ تا ۱۵:۰۰',
        NotificationCategory.system, AlertSeverity.info, 12, read: true);
    for (final uid in ['u-inv', 'u-hk-mgr', 'u-gm']) {
      send(uid, 'n6', 'کمبود موجودی شامپو مهمان', 'موجودی کمتر از نقطه سفارش است.',
          NotificationCategory.inventory, AlertSeverity.warning, 6, route: '/inventory/inv-1');
    }
  }
}
