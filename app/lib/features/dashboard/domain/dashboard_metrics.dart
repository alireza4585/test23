import '../../../core/utils/day_key.dart';
import '../../energy/domain/energy_reading.dart';
import '../../hotel/domain/hotel.dart';
import '../../housekeeping/domain/housekeeping_task.dart';
import '../../inventory/domain/inventory_item.dart';
import '../../maintenance/domain/maintenance_ticket.dart';
import '../../operations/domain/daily_operations.dart';
import '../../rooms/domain/room.dart';
import '../../staff/domain/staff.dart';

class DayValue {
  const DayValue(this.day, this.value);

  final DateTime day;
  final double value;
}

/// Everything the management dashboards show, computed from raw operational
/// data. Pure and synchronous → trivially unit-testable, and the same shape
/// the server-side analytics engine writes to `dailyMetrics/{day}`.
class DashboardMetrics {
  const DashboardMetrics({
    required this.liveOccupancyPct,
    required this.roomsByStatus,
    required this.occupancyTrend,
    required this.electricityTrend,
    required this.electricityBaseline,
    required this.openTickets,
    required this.overdueTickets,
    required this.criticalTickets,
    required this.topTickets,
    required this.tasksDone,
    required this.tasksTotal,
    required this.staffOnDuty,
    required this.lowStockCount,
    this.yesterday,
    this.sameDayLastWeek,
    this.electricityYesterday,
    this.electricityIntensity,
  });

  final double liveOccupancyPct;
  final Map<RoomStatus, int> roomsByStatus;
  final List<DayValue> occupancyTrend;
  final List<DayValue> electricityTrend;
  final double electricityBaseline;
  final DailyOperations? yesterday;
  final DailyOperations? sameDayLastWeek;
  final double? electricityYesterday;

  /// kWh per occupied room over the last 7 days.
  final double? electricityIntensity;
  final int openTickets;
  final int overdueTickets;
  final int criticalTickets;
  final List<MaintenanceTicket> topTickets;
  final int tasksDone;
  final int tasksTotal;
  final int staffOnDuty;
  final int lowStockCount;

  int get roomsReady => roomsByStatus[RoomStatus.vacantClean] ?? 0;
  int get roomsToClean =>
      (roomsByStatus[RoomStatus.vacantDirty] ?? 0) +
      (roomsByStatus[RoomStatus.cleaningInProgress] ?? 0);

  double? get electricityVsBaselinePct =>
      electricityYesterday == null || electricityBaseline <= 0
      ? null
      : (electricityYesterday! - electricityBaseline) / electricityBaseline * 100;

  double? _wow(double Function(DailyOperations o) metric) {
    final a = yesterday;
    final b = sameDayLastWeek;
    if (a == null || b == null || metric(b) == 0) return null;
    return (metric(a) - metric(b)) / metric(b) * 100;
  }

  double? get revparWowPct => _wow((o) => o.revpar);
  double? get adrWowPct => _wow((o) => o.adr);
  double? get revenueWowPct => _wow((o) => o.totalRevenue);

  static DashboardMetrics compute({
    required DateTime now,
    required HotelSettings settings,
    required List<Room> rooms,
    required List<DailyOperations> operations,
    required List<EnergyReading> energy,
    required List<MaintenanceTicket> tickets,
    required List<HousekeepingTask> tasks,
    required List<Shift> shifts,
    required List<InventoryItem> inventory,
    int trendDays = 14,
  }) {
    final today = DayKey.startOfDay(now);
    final yesterdayDay = today.subtract(const Duration(days: 1));

    final byStatus = {
      for (final s in RoomStatus.values) s: rooms.where((r) => r.status == s).length,
    };
    final sellable = rooms.length - (byStatus[RoomStatus.outOfOrder] ?? 0);
    final occupancy = sellable <= 0
        ? 0.0
        : (byStatus[RoomStatus.occupied] ?? 0) / sellable * 100;

    final opsByDay = {for (final o in operations) DayKey.of(o.day): o};
    final trendRange = DayKey.range(
      today.subtract(Duration(days: trendDays)),
      yesterdayDay,
    );
    final occupancyTrend = [
      for (final d in trendRange)
        if (opsByDay[DayKey.of(d)] != null)
          DayValue(d, opsByDay[DayKey.of(d)]!.occupancyRate),
    ];

    final electricityByDay = <String, double>{};
    for (final r in energy.where((r) => r.type == EnergyType.electricity)) {
      electricityByDay.update(
        DayKey.of(r.day),
        (v) => v + r.consumption,
        ifAbsent: () => r.consumption,
      );
    }
    final electricityTrend = [
      for (final d in trendRange)
        if (electricityByDay[DayKey.of(d)] != null)
          DayValue(d, electricityByDay[DayKey.of(d)]!),
    ];

    // Energy intensity over the last 7 complete days.
    var kwh = 0.0;
    var occupiedNights = 0;
    for (final d in DayKey.range(today.subtract(const Duration(days: 7)), yesterdayDay)) {
      final e = electricityByDay[DayKey.of(d)];
      final o = opsByDay[DayKey.of(d)];
      if (e != null && o != null) {
        kwh += e;
        occupiedNights += o.roomsOccupied;
      }
    }

    final active = tickets.where((t) => t.status.isActive).toList()
      ..sort((a, b) {
        final p = b.priority.index.compareTo(a.priority.index);
        return p != 0 ? p : a.slaDueAt.compareTo(b.slaDueAt);
      });

    final todayKey = DayKey.of(today);
    final todaysTasks = tasks.where(
      (t) => DayKey.of(t.createdAt) == todayKey && t.status != TaskStatus.cancelled,
    );

    return DashboardMetrics(
      liveOccupancyPct: occupancy,
      roomsByStatus: byStatus,
      occupancyTrend: occupancyTrend,
      electricityTrend: electricityTrend,
      electricityBaseline: settings.energyDailyBaseline['electricity'] ?? 0,
      yesterday: opsByDay[DayKey.of(yesterdayDay)],
      sameDayLastWeek: opsByDay[DayKey.of(yesterdayDay.subtract(const Duration(days: 7)))],
      electricityYesterday: electricityByDay[DayKey.of(yesterdayDay)],
      electricityIntensity: occupiedNights == 0 ? null : kwh / occupiedNights,
      openTickets: active.length,
      overdueTickets: active.where((t) => t.isOverdue(now)).length,
      criticalTickets: active.where((t) => t.priority == TicketPriority.critical).length,
      topTickets: active.take(4).toList(),
      tasksDone: todaysTasks.where((t) => t.status == TaskStatus.done).length,
      tasksTotal: todaysTasks.length,
      staffOnDuty: shifts.where((s) => s.status == ShiftStatus.checkedIn).length,
      lowStockCount: inventory.where((i) => i.isLowStock).length,
    );
  }
}
