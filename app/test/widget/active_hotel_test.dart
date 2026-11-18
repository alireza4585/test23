import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/data/demo/demo_store.dart';
import 'package:zarin_hooshmand/features/auth/application/auth_providers.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';

import '../helpers/test_app.dart';

/// A synthetic, checksum-valid national ID built at run time (none is written in the repository).
String _syntheticNationalId(String nineDigits) {
  var sum = 0;
  for (var i = 0; i < 9; i++) {
    sum += int.parse(nineDigits[i]) * (10 - i);
  }
  final r = sum % 11;
  return '$nineDigits${r < 2 ? r : 11 - r}';
}

void main() {
  testWidgets('a member of two hotels switches the active hotel from the profile', (tester) async {
    final store = seededStore();
    store.hotels.put(const Hotel(id: 'second-hotel', name: 'هتل دوم', city: 'شیراز', stars: 4, roomCount: 40));
    final nid = _syntheticNationalId(List.generate(9, (i) => '${(i * 7 + 2) % 10}').join());
    store.accountsByNationalId[nid] = DemoAccount(
      uid: 'multi-hotel-gm',
      nationalId: nid,
      password: DemoSeed.demoPassword,
      fullName: 'مدیرکل دو هتل',
      role: AppRole.generalManager,
      hotelIds: const [DemoSeed.hotelId, 'second-hotel'],
    );
    await pumpZarinApp(tester, store: store);
    await signIn(tester, nid);
    expect(containerOf(tester).read(activeHotelIdProvider), DemoSeed.hotelId);

    containerOf(tester).read(routerProvider).go(Routes.profile);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('profile.hotel')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('profile.hotel.second-hotel')));
    await tester.pumpAndSettle();
    expect(containerOf(tester).read(activeHotelIdProvider), 'second-hotel');
    expect(store.accountByUid('multi-hotel-gm')!.activeHotelId, 'second-hotel');
    expect(find.text('هتل دوم'), findsWidgets);
  });

  testWidgets('a member of one hotel has nothing to switch', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, DemoSeed.accounts.firstWhere((a) => a.$3 == AppRole.generalManager).$2);
    containerOf(tester).read(routerProvider).go(Routes.profile);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('profile.hotel')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('profile.hotel.${DemoSeed.hotelId}')), findsNothing);
  });
}
