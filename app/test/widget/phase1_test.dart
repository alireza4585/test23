import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/core/utils/day_key.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/data/repository_providers.dart';
import 'package:zarin_hooshmand/features/actions/domain/ai_action.dart';
import 'package:zarin_hooshmand/features/energy/domain/energy_reading.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';
import 'package:zarin_hooshmand/features/operations/domain/daily_operations.dart';

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

Future<void> _switchUser(WidgetTester tester, AppRole role) async {
  await containerOf(tester).read(authRepositoryProvider).signOut();
  await tester.pumpAndSettle();
  await signIn(tester, _nid(role));
}

Future<void> _actionsTab(WidgetTester tester) async {
  await _open(tester, Routes.insights);
  await tester.tap(find.byKey(const Key('recs.tab.actions')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Action Center: a housekeeping manager cannot decide an energy action; the GM approves it', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.housekeepingManager));
    await _actionsTab(tester);
    // ai-1 is the demo's energy insight → an energy action.
    expect(find.byKey(const Key('action.act-ai-1')), findsOneWidget);
    expect(find.byKey(const Key('action.act-ai-1.approve')), findsNothing);
    expect(find.byKey(const Key('action.act-ai-1.notYours')), findsOneWidget);
    // Its own department's action can be decided.
    await _show(tester, find.byKey(const Key('action.act-ai-3.approve')));
    expect(find.byKey(const Key('action.act-ai-3.approve')), findsOneWidget);

    await _switchUser(tester, AppRole.generalManager);
    await _actionsTab(tester);
    await tester.tap(find.byKey(const Key('action.act-ai-1.approve')));
    await tester.pumpAndSettle();
    expect(store.actions.get('act-ai-1')!.status, ActionStatus.executed);
    await _show(tester, find.byKey(const Key('action.act-ai-1.outcome')));
    expect(find.byKey(const Key('action.act-ai-1.outcome')), findsOneWidget);
  });

  testWidgets('Action Center: rejecting asks for a reason', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    await _actionsTab(tester);
    await tester.tap(find.byKey(const Key('action.act-ai-1.reject')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('action.rejectConfirm')));
    await tester.pumpAndSettle();
    expect(store.actions.get('act-ai-1')!.status, ActionStatus.proposed, reason: 'no note, nothing recorded');
    await tester.tap(find.byKey(const Key('action.act-ai-1.reject')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('action.rejectNote')), 'تعمیر چیلر برنامه‌ریزی شده است');
    await tester.tap(find.byKey(const Key('action.rejectConfirm')));
    await tester.pumpAndSettle();
    expect(store.actions.get('act-ai-1')!.status, ActionStatus.rejected);
  });

  testWidgets('morning briefing: first card of the home page, collapsed, rateable; gone without the flag', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    expect(find.byKey(const Key('briefing.card')), findsOneWidget);
    expect(find.byKey(const Key('kpi.occupancy')), findsOneWidget, reason: 'KPIs stay on the first screen');
    await tester.tap(find.byKey(const Key('briefing.useful')));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.thumb_up), findsOneWidget);

    final store = seededStore();
    final h = store.hotels.get(DemoSeed.hotelId)!;
    store.hotels.put(Hotel(
      id: h.id, name: h.name, city: h.city, stars: h.stars, roomCount: h.roomCount,
      settings: const HotelSettings(features: {HotelFeature.energyBaseline, HotelFeature.recommendationLoop}),
    ));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.generalManager));
    expect(find.byKey(const Key('briefing.card')), findsNothing);
  });

  testWidgets('energy model: the energy manager proposes excluded days with a reason; the GM approves; the list shows them', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.energyManager));
    await _open(tester, Routes.energy);
    final exclude = find.byKey(const Key('energy.excludeDays'));
    await _show(tester, exclude);
    expect(find.byKey(const Key('energy.model.status')), findsOneWidget);
    await tester.tap(exclude);
    await tester.pumpAndSettle();
    // The energy page has its own chips behind the sheet: pick the sheet's by key.
    final today = DayKey.hotelToday(store.clock.now());
    for (final back in [3, 4]) {
      final chip = find.byKey(Key('energy.excludeDay.${DayKey.of(today.subtract(Duration(days: back)))}'));
      await tester.ensureVisible(chip);
      await tester.pumpAndSettle();
      await tester.tap(chip);
      await tester.pumpAndSettle();
    }
    await tester.enterText(find.byKey(const Key('energy.excludeReason')), 'نمایشگاه بین‌المللی و بار اضافهٔ سالن‌ها');
    await tester.ensureVisible(find.byKey(const Key('energy.excludeSubmit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('energy.excludeSubmit')));
    await tester.pumpAndSettle();
    final proposal = store.actions.all.singleWhere((a) => a.type == ActionType.adjustBaseline);
    expect(proposal.status, ActionStatus.proposed);
    expect((proposal.params['days'] as List).length, 2);

    await _switchUser(tester, AppRole.generalManager);
    await _actionsTab(tester);
    await _show(tester, find.byKey(Key('action.${proposal.id}.approve')));
    await tester.tap(find.byKey(Key('action.${proposal.id}.approve')));
    await tester.pumpAndSettle();
    expect(store.energyExclusions.all.length, 2);
    await _open(tester, Routes.energy);
    await _show(tester, find.byKey(const Key('energy.exclusions')));
    expect(find.textContaining('نمایشگاه بین‌المللی'), findsNWidgets(2));
  });

  testWidgets('only the GM and the energy manager may propose excluded days', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.operationsManager));
    await _open(tester, Routes.energy);
    await _show(tester, find.byKey(const Key('energy.exclusions')));
    expect(find.byKey(const Key('energy.excludeDays')), findsNothing);
  });

  testWidgets('energy model: an impossible reading is labelled a data error, not a spike', (tester) async {
    final store = seededStore();
    final yesterday = DayKey.hotelToday(store.clock.now()).subtract(const Duration(days: 1));
    // The demo baseline needs history before its 35-day window: copies of the seeded days, 35 and 70 days back.
    final ops = store.operations.all.toList();
    final elec = store.energy.all.where((e) => e.type == EnergyType.electricity).toList();
    for (final back in [35, 70]) {
      for (final o in ops) {
        store.operations.put(DailyOperations(
          day: o.day.subtract(Duration(days: back)), roomsAvailable: o.roomsAvailable, roomsOccupied: o.roomsOccupied,
          guests: o.guests, roomRevenue: o.roomRevenue,
        ));
      }
      for (final e in elec) {
        final day = e.day.subtract(Duration(days: back));
        store.energy.put(EnergyReading(
          id: '${DayKey.of(day)}_${e.type.name}', type: e.type, day: day, consumption: e.consumption, source: e.source,
          recordedByName: e.recordedByName, createdAt: e.createdAt,
        ));
      }
    }
    // A keyboard slip: yesterday's electricity entered three times too high.
    final r = elec.firstWhere((e) => DayKey.of(e.day) == DayKey.of(yesterday));
    store.energy.put(EnergyReading(
      id: r.id, type: r.type, day: r.day, consumption: r.consumption * 3, source: r.source,
      recordedByName: r.recordedByName, createdAt: r.createdAt,
    ));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.energyManager));
    await _open(tester, Routes.energy);
    final pill = find.byKey(Key('energy.dataError.${DayKey.of(yesterday)}'));
    await _show(tester, pill);
    expect(pill, findsOneWidget);
    expect(find.text('خطای داده'), findsOneWidget);
  });
}
