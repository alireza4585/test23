import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/features/auth/presentation/auth_misc_pages.dart';
import 'package:zarin_hooshmand/features/auth/presentation/login_page.dart';
import 'package:zarin_hooshmand/features/dashboard/presentation/executive_dashboard.dart';
import 'package:zarin_hooshmand/features/dashboard/presentation/operations_dashboard.dart';
import 'package:zarin_hooshmand/features/dashboard/presentation/staff_home.dart';
import 'package:zarin_hooshmand/features/housekeeping/domain/housekeeping_task.dart';
import 'package:zarin_hooshmand/features/rooms/domain/room.dart';

import '../helpers/test_app.dart';

void main() {
  testWidgets('unauthenticated users land on the login page', (tester) async {
    await pumpZarinApp(tester);
    expect(find.byType(LoginPage), findsOneWidget);
    expect(find.byKey(const Key('login.demoAccounts')), findsOneWidget);
  });

  testWidgets('invalid national ID is rejected before hitting the backend', (tester) async {
    await pumpZarinApp(tester);
    await tester.enterText(find.byKey(const Key('login.nationalId')), '1234567890');
    await tester.enterText(find.byKey(const Key('login.password')), 'whatever1');
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();
    expect(find.text('کد ملی معتبر نیست'), findsOneWidget);
    expect(find.byType(LoginPage), findsOneWidget);
  });

  testWidgets('wrong password shows a localized error', (tester) async {
    await pumpZarinApp(tester);
    await tester.enterText(find.byKey(const Key('login.nationalId')), '0012345679');
    await tester.enterText(find.byKey(const Key('login.password')), 'wrongPass1');
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();
    expect(find.text('کد ملی یا رمز عبور نادرست است.'), findsOneWidget);
  });

  testWidgets('general manager gets the executive dashboard', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    expect(find.byType(ExecutiveDashboard), findsOneWidget);
    expect(find.byKey(const Key('kpi.occupancy')), findsOneWidget);
    expect(find.byKey(const Key('kpi.electricity')), findsOneWidget);
    expect(find.byKey(const Key('kpi.tickets')), findsOneWidget);
  });

  testWidgets('housekeeper completes the next task in one tap and the room becomes ready', (
    tester,
  ) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, '0102345678');

    expect(find.byType(StaffHome), findsOneWidget);
    // In-progress task (room 205) is surfaced first.
    expect(find.byKey(const Key('staff.nextTask')), findsOneWidget);
    expect(find.text('اتاق ۲۰۵'), findsWidgets);
    expect(store.rooms.get('room-205')!.status, RoomStatus.cleaningInProgress);

    await tester.tap(find.byKey(const Key('staff.nextTask.action')));
    await tester.pumpAndSettle();

    expect(store.tasks.get('t-3')!.status, TaskStatus.done);
    expect(store.rooms.get('room-205')!.status, RoomStatus.vacantClean);
    // Next up is the urgent checkout in room 204, waiting to be started.
    expect(find.text('اتاق ۲۰۴'), findsWidgets);
    expect(find.text('شروع کار'), findsOneWidget);
  });

  testWidgets('a housekeeper cannot open the energy module, even by URL', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0102345678');

    containerOf(tester).read(routerProvider).go(Routes.energy);
    await tester.pumpAndSettle();
    expect(find.byType(AccessDeniedPage), findsOneWidget);
  });

  testWidgets('department managers get their console, not the executive view', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0056789122'); // maintenance manager
    expect(find.byType(OperationsDashboard), findsOneWidget);
    expect(find.byType(ExecutiveDashboard), findsNothing);
  });
}
