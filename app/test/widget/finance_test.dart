import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/l10n/l10n.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/core/utils/day_key.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/features/ai/domain/ai_models.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';
import 'package:zarin_hooshmand/features/operations/domain/daily_operations.dart';
import 'package:zarin_hooshmand/features/reports/application/report_generator.dart';

import '../helpers/test_app.dart';

String _nid(AppRole role) => DemoSeed.accounts.firstWhere((a) => a.$3 == role).$2;

bool _isVertical(Widget w) => w is Scrollable && w.axisDirection == AxisDirection.down;
Finder get _pageList => find.byWidgetPredicate(_isVertical).last;

Future<void> _open(WidgetTester tester, String route) async {
  containerOf(tester).read(routerProvider).go(route);
  await tester.pumpAndSettle();
}

Future<void> _show(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: _pageList);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('reception records revenue write-only, after confirming the typed amounts', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.receptionStaff));
    await _open(tester, Routes.dailyOps);
    final today = DayKey.hotelToday(testNow);
    final before = store.operations.all.where((o) => o.day == today).firstOrNull;

    await tester.enterText(find.byKey(const Key('dailyOps.guests')), '70');
    final room = find.byKey(const Key('dailyOps.roomRevenue'));
    await _show(tester, room);
    for (final k in ['dailyOps.roomRevenue', 'dailyOps.fnbRevenue', 'dailyOps.otherRevenue']) {
      expect(tester.widget<TextFormField>(find.byKey(Key(k))).controller!.text, isEmpty, reason: 'never prefilled');
    }
    await tester.enterText(room, '120000000');
    await tester.enterText(find.byKey(const Key('dailyOps.fnbRevenue')), '30000000');
    await _show(tester, find.byKey(const Key('dailyOps.save')));
    await tester.tap(find.byKey(const Key('dailyOps.save')));
    await tester.pumpAndSettle();

    // The confirmation shows exactly what was typed (and the total), nothing stored.
    final dialog = find.byKey(const Key('dailyOps.confirmRevenue'));
    expect(dialog, findsOneWidget);
    const fmt = Formatters('fa');
    for (final v in [120000000, 30000000, 0, 150000000]) {
      expect(find.descendant(of: dialog, matching: find.textContaining(fmt.money(v))), findsWidgets);
    }
    await tester.tap(find.byKey(const Key('dailyOps.confirmRevenue.edit')));
    await tester.pumpAndSettle();
    expect(store.operations.all.where((o) => o.day == today).firstOrNull?.roomRevenue, before?.roomRevenue);

    await tester.tap(find.byKey(const Key('dailyOps.save')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('dailyOps.confirmRevenue.ok')));
    await tester.pumpAndSettle();

    final saved = store.operations.all.firstWhere((o) => o.day == today);
    expect([saved.roomRevenue, saved.fnbRevenue, saved.otherRevenue], [120000000, 30000000, 0]);
    expect(saved.financeRecorded, isTrue);
    expect(tester.widget<TextFormField>(room).controller!.text, isEmpty, reason: 'cleared after saving');
    await _show(tester, find.byKey(const Key('dailyOps.revenueRecorded')));
    expect(find.byKey(const Key('dailyOps.revenueRecorded')), findsOneWidget);
  });

  testWidgets('saving occupancy alone does not ask about or change revenue', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.operationsManager));
    await _open(tester, Routes.dailyOps);
    final yesterday = DayKey.hotelToday(testNow).subtract(const Duration(days: 1));
    final before = store.operations.all.where((o) => o.day == DayKey.hotelToday(testNow)).firstOrNull;
    await tester.enterText(find.byKey(const Key('dailyOps.guests')), '70');
    await _show(tester, find.byKey(const Key('dailyOps.save')));
    await tester.tap(find.byKey(const Key('dailyOps.save')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dailyOps.confirmRevenue')), findsNothing);
    final after = store.operations.all.firstWhere((o) => o.day == DayKey.hotelToday(testNow));
    expect(after.roomRevenue, before?.roomRevenue ?? 0);
    expect(store.operations.all.firstWhere((o) => o.day == yesterday).roomRevenue, greaterThan(0));
  });

  testWidgets('without finance.view: no revenue KPIs and no revenue forecasts', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.operationsManager));
    expect(find.byKey(const Key('kpi.revpar')), findsNothing);
    await _open(tester, Routes.forecasts);
    await _show(tester, find.byKey(const Key('forecast.occupancy')));
    expect(find.byKey(const Key('forecast.roomRevenue')), findsNothing);
    expect(find.byKey(const Key('forecast.totalRevenue')), findsNothing);
  });

  testWidgets('with finance.view: the GM sees revenue KPIs and revenue forecasts', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    expect(find.byKey(const Key('kpi.revpar')), findsOneWidget);
    await _open(tester, Routes.forecasts);
    await _show(tester, find.byKey(const Key('forecast.roomRevenue')));
    expect(find.byKey(const Key('forecast.roomRevenue')), findsOneWidget);
  });

  test('the executive-summary PDF has revenue rows only with finance.view', () async {
    final l10n = await AppLocalizations.delegate.load(const Locale('fa'));
    const fmt = Formatters('fa');
    final ops = [
      DailyOperations(day: DateTime(2026, 10, 1), roomsAvailable: 50, roomsOccupied: 40, guests: 60, roomRevenue: 4e9, fnbRevenue: 1e9),
    ];
    expect(financeSummaryRows(ops, canFinance: false, l10n: l10n, fmt: fmt), isEmpty);
    final rows = financeSummaryRows(ops, canFinance: true, l10n: l10n, fmt: fmt);
    expect(rows.map((r) => r.first), [l10n.kpiAdr, l10n.kpiRevpar, l10n.kpiRevenue]);
    expect(rows.first[1], fmt.money(1e8));
  });

  testWidgets('without the recommendationLoop flag the insights page keeps accept / implemented / dismiss', (tester) async {
    final store = seededStore();
    final h = store.hotels.get(DemoSeed.hotelId)!;
    store.hotels.put(Hotel(
      id: h.id, name: h.name, city: h.city, stars: h.stars, roomCount: h.roomCount,
      settings: const HotelSettings(features: {HotelFeature.forecasts}),
    ));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.generalManager));
    await _open(tester, Routes.insights);
    expect(find.byKey(const Key('insights.classic')), findsOneWidget);
    expect(find.byKey(const Key('recs.tab.open')), findsNothing);
    final open = store.insights.all.firstWhere((i) => i.status == InsightStatus.active);
    final accept = find.byKey(Key('insight.${open.id}.accept'));
    await _show(tester, accept);
    expect(find.byKey(Key('insight.${open.id}.decide')), findsNothing);
    await tester.tap(accept);
    await tester.pumpAndSettle();
    expect(store.insights.get(open.id)!.status, InsightStatus.accepted);
  });
}
