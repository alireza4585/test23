import 'dart:async';

import '../../core/security/app_role.dart';
import '../../core/utils/clock.dart';
import '../../core/utils/day_key.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/auth/domain/user_session.dart';
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
import 'demo_collection.dart';
import 'demo_seed.dart';

/// A demo login. Passwords are only ever stored like this in the offline demo
/// backend; real credentials live in Firebase Auth / the identity service.
class DemoAccount {
  DemoAccount({
    required this.uid,
    required this.nationalId,
    required this.password,
    required this.fullName,
    required this.role,
    this.hotelIds = const [DemoSeed.hotelId],
    this.staffId,
    this.phone,
    this.status = UserStatus.active,
    this.lastLoginAt,
  });

  final String uid;
  final String nationalId;
  String password;
  final String fullName;
  final AppRole role;
  final List<String> hotelIds;
  final String? staffId;
  final String? phone;
  UserStatus status;
  DateTime? lastLoginAt;
}

/// The whole demo "database". One instance per app run (or per test).
class DemoStore {
  DemoStore({
    this.clock = const Clock(),
    this.simulatedLatency = const Duration(milliseconds: 250),
  });

  /// A store pre-populated with a realistic 60-room hotel.
  factory DemoStore.seeded({
    Clock clock = const Clock(),
    Duration simulatedLatency = const Duration(milliseconds: 250),
  }) {
    final store = DemoStore(clock: clock, simulatedLatency: simulatedLatency);
    DemoSeed(store, clock.now()).populate();
    return store;
  }

  final Clock clock;

  /// Artificial delay on writes so loading states are visible in demos.
  /// Tests pass [Duration.zero].
  final Duration simulatedLatency;
  int _sequence = 0;

  final Map<String, DemoAccount> accountsByNationalId = {};

  final hotels = DemoCollection<Hotel>((h) => h.id);
  final rooms = DemoCollection<Room>((r) => r.id);
  final tasks = DemoCollection<HousekeepingTask>((t) => t.id);
  final tickets = DemoCollection<MaintenanceTicket>((t) => t.id);
  final ticketEvents = DemoCollection<Scoped<TicketEvent>>((e) => e.id);
  final energy = DemoCollection<EnergyReading>((r) => r.id);
  final operations = DemoCollection<DailyOperations>((o) => DayKey.of(o.day));
  final items = DemoCollection<InventoryItem>((i) => i.id);
  final movements = DemoCollection<StockMovement>((m) => m.id);
  final staff = DemoCollection<StaffMember>((s) => s.id);
  final shifts = DemoCollection<Shift>((s) => s.id);
  final alerts = DemoCollection<HotelAlert>((a) => a.id);
  final inbox = DemoCollection<Scoped<InboxNotification>>((n) => n.id);
  final insights = DemoCollection<AiInsight>((i) => i.id);
  final reports = DemoCollection<ReportRecord>((r) => r.id);
  final sessions = DemoCollection<Scoped<UserSession>>((s) => s.id);

  /// Append-only audit trail (mirrors `hotels/{id}/auditLogs`).
  final List<String> auditLog = [];

  /// Emits the uid of the signed-in demo user (or null).
  final StreamController<String?> authChanges =
      StreamController<String?>.broadcast();
  String? signedInUid;

  Iterable<DemoAccount> get accounts => accountsByNationalId.values;

  DemoAccount? accountByUid(String uid) {
    for (final a in accounts) {
      if (a.uid == uid) return a;
    }
    return null;
  }

  String nextId(String prefix) {
    _sequence++;
    return '$prefix-${clock.now().microsecondsSinceEpoch}-$_sequence';
  }

  void audit(String actorName, String action, String resource) {
    auditLog.add('${clock.now().toIso8601String()} | $actorName | $action | $resource');
  }

  Future<void> latency() => simulatedLatency == Duration.zero
      ? Future<void>.value()
      : Future<void>.delayed(simulatedLatency);
}
