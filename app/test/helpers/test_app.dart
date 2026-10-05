import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/app.dart';
import 'package:zarin_hooshmand/core/config/app_config.dart';
import 'package:zarin_hooshmand/core/di/core_providers.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/core/security/role_policy.dart';
import 'package:zarin_hooshmand/core/utils/clock.dart';
import 'package:zarin_hooshmand/data/backend.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/data/demo/demo_store.dart';
import 'package:zarin_hooshmand/features/auth/domain/app_user.dart';

/// Monday 5 Oct 2026, 10:00 — all seeded data is relative to this.
final testNow = DateTime(2026, 10, 5, 10);

DemoStore seededStore() => DemoStore.seeded(
  clock: FixedClock(testNow),
  simulatedLatency: Duration.zero,
);

/// Pumps the full app (router, guards, shell) on the demo backend at phone
/// size, returning the store so tests can assert on persisted state.
Future<DemoStore> pumpZarinApp(WidgetTester tester, {DemoStore? store}) async {
  final s = store ?? seededStore();
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(
          const AppConfig(backend: BackendKind.demo, environment: 'test'),
        ),
        backendProvider.overrideWithValue(DemoBackend(s)),
        clockProvider.overrideWithValue(FixedClock(testNow)),
      ],
      child: const ZarinApp(),
    ),
  );
  await tester.pumpAndSettle();
  return s;
}

Future<void> signIn(WidgetTester tester, String nationalId) async {
  await tester.enterText(find.byKey(const Key('login.nationalId')), nationalId);
  await tester.enterText(find.byKey(const Key('login.password')), DemoSeed.demoPassword);
  await tester.tap(find.byKey(const Key('login.submit')));
  await tester.pumpAndSettle();
}

ProviderContainer containerOf(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(ZarinApp)));

AppUser userWith(AppRole role, {String uid = 'u', bool mustChangePassword = false}) => AppUser(
  uid: uid,
  nationalId: '0012345679',
  fullName: 'Test User',
  role: role,
  hotelIds: const ['h'],
  permissions: RolePolicy.resolve(role),
  mustChangePassword: mustChangePassword,
);
