import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/features/ai/domain/ai_models.dart';
import 'package:zarin_hooshmand/features/auth/presentation/auth_misc_pages.dart';
import 'package:zarin_hooshmand/features/calendar/domain/calendar_event.dart';
import 'package:zarin_hooshmand/features/forecast/presentation/forecasts_page.dart';

import '../helpers/test_app.dart';

bool _isVertical(Widget w) => w is Scrollable && w.axisDirection == AxisDirection.down;

/// The visible tab's list in the recommendation center.
Finder get _tabList => find.descendant(of: find.byType(TabBarView), matching: find.byWidgetPredicate(_isVertical)).first;

/// The main page list (dashboard).
Finder get _pageList => find.byWidgetPredicate(_isVertical).last;

void main() {
  testWidgets('a manager accepts a recommendation with a linked ticket and it waits for evaluation', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    containerOf(tester).read(routerProvider).go(Routes.insights);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('recs.expected')), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const Key('insight.ai-1.decide')), 300, scrollable: _tabList);
    await tester.ensureVisible(find.byKey(const Key('insight.ai-1.decide')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('insight.ai-1.decide')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('decision.note')), 'سرویس چیلر این هفته');
    await tester.tap(find.byKey(const Key('decision.ticket')));
    await tester.tap(find.byKey(const Key('decision.save')));
    await tester.pumpAndSettle();

    final insight = store.insights.get('ai-1')!;
    expect(insight.status, InsightStatus.accepted);
    expect(insight.decisionNote, 'سرویس چیلر این هفته');
    expect(insight.evaluation!.status, EvaluationStatus.pending);
    final ticket = store.tickets.get(insight.linkedTicketId!)!;
    expect(ticket.title, insight.title);

    // It moved to the "decided" tab, with its linked ticket and pending evaluation.
    expect(find.byKey(const Key('insight.ai-1')), findsNothing);
    await tester.tap(find.byKey(const Key('recs.tab.decided')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byKey(const Key('insight.ai-1.ticket')), 300, scrollable: _tabList);
    await tester.ensureVisible(find.byKey(const Key('insight.ai-1.ticket')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('insight.ai-1')), findsOneWidget);
    expect(find.byKey(const Key('insight.ai-1.ticket')), findsOneWidget);
    expect(find.byKey(const Key('insight.evaluation')), findsOneWidget);
  });

  testWidgets('executives see forecasts with their model and accuracy', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    await tester.scrollUntilVisible(find.byKey(const Key('dashboard.forecast')), 300, scrollable: _pageList);
    await tester.ensureVisible(find.byKey(const Key('dashboard.forecast')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dashboard.forecast')), findsOneWidget);
    containerOf(tester).read(routerProvider).go(Routes.forecasts);
    await tester.pumpAndSettle();
    expect(find.byType(ForecastsPage), findsOneWidget);
    expect(find.byKey(const Key('forecast.occupancy')), findsOneWidget);
    expect(find.textContaining('همان روز هفتهٔ قبل'), findsWidgets);
    expect(find.byKey(const Key('forecasts.refresh')), findsOneWidget);
  });

  testWidgets('a manager adds a lunar holiday to the calendar', (tester) async {
    final store = await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    containerOf(tester).read(routerProvider).go(Routes.calendar);
    await tester.pumpAndSettle();
    expect(find.text('نوروز'), findsWidgets);

    await tester.tap(find.byKey(const Key('calendar.add')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('calendar.title')), 'تاسوعا و عاشورا');
    await tester.tap(find.byKey(const Key('calendar.from')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK').evaluate().isNotEmpty ? find.text('OK') : find.text('تأیید'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('calendar.save')));
    await tester.pumpAndSettle();

    final events = store.calendarEvents.all.toList();
    expect(events, hasLength(1));
    expect(events.single.title, 'تاسوعا و عاشورا');
    expect(events.single.kind, CalendarEventKind.religious);
    expect(find.text('تاسوعا و عاشورا'), findsOneWidget);
  });

  testWidgets('staff cannot open forecasts or the calendar settings', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0102345678');
    for (final route in [Routes.forecasts, Routes.calendar]) {
      containerOf(tester).read(routerProvider).go(route);
      await tester.pumpAndSettle();
      expect(find.byType(AccessDeniedPage), findsOneWidget);
    }
  });

  testWidgets('the energy page explains the baseline (or why there is none yet)', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, '0012345679');
    containerOf(tester).read(routerProvider).go(Routes.energy);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byKey(const Key('energy.baseline')), 300, scrollable: _pageList);
    await tester.pumpAndSettle();
    // The demo hotel has 45 days of history: too short for a baseline fitted on the year before the last 30 days.
    expect(find.textContaining('۲۸ روز'), findsOneWidget);
    expect(find.textContaining('CO₂'), findsWidgets);
  });
}
