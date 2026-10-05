// Integration tests of the PocketBase adapters against a live, seeded server.
//
//   cd pocketbase && node scripts/test-server.mjs      # prints ZH_PB_TEST_URL=…
//   cd app && ZH_PB_TEST_URL=http://127.0.0.1:PORT flutter test test/pocketbase
//
// Skipped when ZH_PB_TEST_URL is not set (regular `flutter test` runs).
@Tags(['pocketbase'])
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pocketbase/pocketbase.dart';
import 'package:zarin_hooshmand/core/domain/media_file.dart';
import 'package:zarin_hooshmand/core/error/app_failure.dart';
import 'package:zarin_hooshmand/core/platform/platform_services.dart';
import 'package:zarin_hooshmand/core/security/app_permission.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/data/pocketbase/pb_auth_repository.dart';
import 'package:zarin_hooshmand/data/pocketbase/pb_engagement_repositories.dart';
import 'package:zarin_hooshmand/data/pocketbase/pb_operations_repositories.dart';
import 'package:zarin_hooshmand/features/admin/domain/user_admin.dart';
import 'package:zarin_hooshmand/features/ai/domain/ai_models.dart';
import 'package:zarin_hooshmand/features/auth/domain/app_user.dart';
import 'package:zarin_hooshmand/features/energy/domain/energy_reading.dart';
import 'package:zarin_hooshmand/features/housekeeping/domain/housekeeping_task.dart';
import 'package:zarin_hooshmand/features/inventory/domain/inventory_item.dart';
import 'package:zarin_hooshmand/features/maintenance/domain/maintenance_ticket.dart';
import 'package:zarin_hooshmand/features/rooms/domain/room.dart';

final _url = Platform.environment['ZH_PB_TEST_URL'];
const _password = 'Zarin@2026';

class _Session {
  _Session._(this.pb, this.auth, this.user);

  final PocketBase pb;
  final PocketBaseAuthRepository auth;
  final AppUser user;

  static Future<_Session> signIn(String nationalId, [String password = _password]) async {
    final pb = PocketBase(_url!);
    final auth = PocketBaseAuthRepository(pb, InMemorySecureStore());
    final user = await auth.signIn(nationalId: nationalId, password: password);
    return _Session._(pb, auth, user);
  }
}

/// First stream value matching [test] (realtime updates arrive asynchronously).
Future<T> firstWhere<T>(Stream<T> stream, bool Function(T) test) =>
    stream.firstWhere(test).timeout(const Duration(seconds: 10));

void main() {
  final skip = _url == null ? 'set ZH_PB_TEST_URL to run against a live PocketBase' : null;

  test('national ID sign-in yields the role, hotel and server-computed permissions', () async {
    final s = await _Session.signIn('0102345678');
    expect(s.user.role, AppRole.housekeepingStaff);
    expect(s.user.nationalId, '0102345678');
    expect(s.user.permissions, contains(AppPermission.housekeepingComplete));
    expect(s.user.permissions, isNot(contains(AppPermission.energyView)));
    expect(s.user.activeHotelId, isNotEmpty);
    expect(await s.auth.watchCurrentUser().first, isA<AppUser>());
  }, skip: skip);

  test('wrong password maps to InvalidCredentialsFailure', () async {
    final auth = PocketBaseAuthRepository(PocketBase(_url ?? ''), InMemorySecureStore());
    await expectLater(
      auth.signIn(nationalId: '0012345679', password: 'wrong-pass-1'),
      throwsA(isA<InvalidCredentialsFailure>()),
    );
  }, skip: skip);

  test('one-tap cleaning: task + room move together and realtime updates the room', () async {
    final s = await _Session.signIn('0102345678');
    final hotelId = s.user.hotelId;
    final tasks = PocketBaseHousekeepingRepository(s.pb);
    final rooms = PocketBaseRoomsRepository(s.pb);

    final mine = await tasks.watchTasks(hotelId, day: DateTime.now(), assigneeId: s.user.uid).first;
    final task = mine.firstWhere((t) => t.roomNumber == '107' && t.status == TaskStatus.pending);
    final roomUpdates = rooms.watchRoom(hotelId, task.roomId).asBroadcastStream();
    expect((await roomUpdates.first)!.status, RoomStatus.vacantDirty);

    await tasks.transition(
      hotelId,
      task: task,
      status: TaskStatus.inProgress,
      actor: s.user.asActor,
      roomChange: RoomStatusChange(roomId: task.roomId, from: RoomStatus.vacantDirty, to: RoomStatus.cleaningInProgress),
    );
    final live = await firstWhere(roomUpdates, (r) => r?.status == RoomStatus.cleaningInProgress);
    expect(live!.updatedByName, s.user.fullName);

    // A stale client state is rejected with the app's message code.
    await expectLater(
      tasks.transition(hotelId, task: task, status: TaskStatus.inProgress, actor: s.user.asActor),
      throwsA(isA<ValidationFailure>().having((f) => f.code, 'code', 'task_status_changed')),
    );
  }, skip: skip);

  test('maintenance: report with a photo, then the manager sees and assigns it', () async {
    final hk = await _Session.signIn('0102345678');
    final mm = await _Session.signIn('0056789122');
    final tech = await _Session.signIn('0124567894');
    final hotelId = hk.user.hotelId;
    final repo = PocketBaseMaintenanceRepository(hk.pb);

    final id = await repo.createTicket(
      hotelId,
      TicketDraft(
        title: 'شکستگی شیشه پنجره',
        description: 'شیشه ترک خورده است',
        category: TicketCategory.structural,
        priority: TicketPriority.medium,
        area: 'لابی',
        photos: [MediaFile(name: 'crack.png', bytes: _png, mimeType: 'image/png')],
      ),
      hk.user.asActor,
      slaDueAt: DateTime.now(),
    );
    final mine = await repo.watchTickets(hotelId, scope: MyTickets(hk.user.uid)).first;
    final created = mine.firstWhere((t) => t.id == id);
    expect(created.photoPaths, hasLength(1));
    expect(created.reportedById, hk.user.uid);
    expect(created.slaDueAt.isAfter(DateTime.now().add(const Duration(hours: 23))), isTrue);

    final mmRepo = PocketBaseMaintenanceRepository(mm.pb);
    await mmRepo.assign(hotelId, ticket: created, assigneeId: tech.user.uid, assigneeName: '', actor: mm.user.asActor);
    final techTickets = await PocketBaseMaintenanceRepository(tech.pb)
        .watchTickets(hotelId, scope: MyTickets(tech.user.uid), activeOnly: true)
        .first;
    final assigned = techTickets.firstWhere((t) => t.id == id);
    expect(assigned.status, TicketStatus.assigned);
    final events = await mmRepo.watchEvents(hotelId, id).first;
    expect(events.map((e) => e.type), [TicketEventType.created, TicketEventType.assigned]);
  }, skip: skip);

  test('inventory movement errors map to the app message codes', () async {
    final s = await _Session.signIn('0078912342');
    final repo = PocketBaseInventoryRepository(s.pb);
    final item = (await repo.watchItems(s.user.hotelId).first).first;
    await expectLater(
      repo.recordMovement(s.user.hotelId, itemId: item.id, type: MovementType.issue, delta: -(item.quantity + 1), actor: s.user.asActor),
      throwsA(isA<ValidationFailure>().having((f) => f.code, 'code', 'insufficient_stock')),
    );
  }, skip: skip);

  test('energy readings upsert per day and type', () async {
    final s = await _Session.signIn('0045678911');
    final repo = PocketBaseEnergyRepository(s.pb);
    final day = DateTime(2026, 2, 3);
    for (final value in [100.0, 120.0]) {
      await repo.saveReading(
        s.user.hotelId,
        EnergyReadingDraft(type: EnergyType.water, day: day, consumption: value),
        s.user.asActor,
      );
    }
    final readings = await repo.watchReadings(s.user.hotelId, from: day, to: day).first;
    expect(readings.where((r) => r.type == EnergyType.water).map((r) => r.consumption), [120.0]);
  }, skip: skip);

  test('alerts, insights stream and the assistant work for the GM', () async {
    final s = await _Session.signIn('0012345679');
    final alerts = await PocketBaseNotificationsRepository(s.pb)
        .watchAlerts(s.user.hotelId, roleCode: s.user.role.code)
        .first;
    expect(alerts, isNotEmpty);
    final reply = await PocketBaseAiAssistantRepository(s.pb).ask(
      hotelId: s.user.hotelId,
      question: 'چرا مصرف برق زیاد شده؟',
      history: [ChatMessage(role: ChatRole.user, text: 'سلام', at: DateTime.now())],
      localeCode: 'fa',
    );
    expect(reply.text, contains('برق'));
    expect(reply.dataPoints, hasLength(3));
  }, skip: skip);

  test('a provisioned user must change the temporary password and stays signed in', () async {
    final hr = await _Session.signIn('0089123451');
    await PocketBaseUserAdminRepository(hr.pb).createUser(
      NewUserRequest(
        hotelId: hr.user.hotelId,
        nationalId: '0201630516',
        fullName: 'پذیرشگر جدید',
        role: AppRole.receptionStaff,
        temporaryPassword: 'Temp-2026a',
      ),
    );
    final fresh = await _Session.signIn('0201630516', 'Temp-2026a');
    expect(fresh.user.mustChangePassword, isTrue);
    await fresh.auth.changePassword(currentPassword: 'Temp-2026a', newPassword: 'Mine-2026b');
    final after = await firstWhere(fresh.auth.watchCurrentUser(), (u) => u != null && !u.mustChangePassword);
    expect(after!.uid, fresh.user.uid);

    final users = await PocketBaseUserAdminRepository(hr.pb).watchUsers(hr.user.hotelId).first;
    final listed = users.firstWhere((u) => u.uid == fresh.user.uid);
    expect(listed.nationalIdMasked, '020•••••16');
    expect(listed.status, UserStatus.active);
  }, skip: skip);
}

/// 1×1 transparent PNG.
final _png = Uint8List.fromList(const [
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);
