// Renders marketing / review screenshots of key screens on the demo backend.
//
//   flutter test --update-goldens tool/screenshots_test.dart
//
// PNGs are written to tool/screenshots/. Not part of the regular test suite.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/app.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';

import '../test/helpers/test_app.dart';

Future<void> _loadFonts() async {
  final vazir = FontLoader('Vazirmatn');
  for (final w in ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold']) {
    vazir.addFont(rootBundle.load('assets/fonts/Vazirmatn-$w.ttf'));
  }
  await vazir.load();
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ??
      File(Platform.resolvedExecutable).parent.parent.parent.parent.parent.path;
  final iconsFile = File('$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (iconsFile.existsSync()) {
    final icons = FontLoader('MaterialIcons')
      ..addFont(Future.value(ByteData.sublistView(iconsFile.readAsBytesSync())));
    await icons.load();
  }
}

Future<void> _shot(WidgetTester tester, String name) async {
  await tester.pumpAndSettle();
  await expectLater(find.byType(ZarinApp), matchesGoldenFile('screenshots/$name.png'));
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('login', (tester) async {
    await pumpZarinApp(tester);
    await _shot(tester, '01_login');
  });

  testWidgets('executive dashboard', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    await _shot(tester, '02_gm_dashboard');
  });

  testWidgets('staff my work', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0102345678');
    await _shot(tester, '03_housekeeper_home');
  });

  testWidgets('rooms, energy, maintenance, assistant (GM)', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    final router = containerOf(tester).read(routerProvider);
    router.go(Routes.rooms);
    await _shot(tester, '04_rooms');
    router.go(Routes.energy);
    await _shot(tester, '05_energy');
    router.go(Routes.maintenance);
    await _shot(tester, '06_maintenance');
    router.go(Routes.insights);
    await _shot(tester, '07_insights');
    unawaited(router.push(Routes.assistant));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('assistant.input')), 'چرا مصرف برق زیاد شده؟');
    await tester.tap(find.byKey(const Key('assistant.send')));
    await _shot(tester, '08_assistant');
  });
}
