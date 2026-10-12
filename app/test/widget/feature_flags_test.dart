import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/config/app_config.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/navigation.dart';
import 'package:zarin_hooshmand/core/routing/route_features.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/widgets/components.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/features/auth/application/auth_providers.dart';
import 'package:zarin_hooshmand/features/auth/presentation/auth_misc_pages.dart';
import 'package:zarin_hooshmand/features/dashboard/presentation/dashboard_widgets.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';

import '../helpers/test_app.dart';

bool _isVertical(Widget w) => w is Scrollable && w.axisDirection == AxisDirection.down;
Finder get _pageList => find.byWidgetPredicate(_isVertical).last;

const _gm = '0012345679';

void main() {
  testWidgets('ZH_ENABLE_AI_ASSISTANT=false removes the assistant route, menu entry and call-to-action', (tester) async {
    await pumpZarinApp(
      tester,
      config: const AppConfig(backend: BackendKind.demo, environment: 'test', enableAiAssistant: false),
    );
    await signIn(tester, _gm);
    final container = containerOf(tester);
    final user = container.read(sessionUserProvider)!;
    final destinations = RoleExperience.destinationsFor(user, disabled: container.read(disabledRoutesProvider));
    expect(destinations.map((d) => d.item), isNot(contains(NavItem.assistant)));

    await tester.scrollUntilVisible(find.byType(AssistantCta), 300, scrollable: _pageList);
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byType(AssistantCta), matching: find.byType(ZCard)), findsNothing);

    container.read(routerProvider).go(Routes.assistant);
    await tester.pumpAndSettle();
    expect(find.byType(AccessDeniedPage), findsOneWidget);
  });

  testWidgets('the assistant is available by default', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _gm);
    final container = containerOf(tester);
    final user = container.read(sessionUserProvider)!;
    expect(
      RoleExperience.destinationsFor(user, disabled: container.read(disabledRoutesProvider)).map((d) => d.item),
      contains(NavItem.assistant),
    );
    await tester.scrollUntilVisible(find.byType(AssistantCta), 300, scrollable: _pageList);
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byType(AssistantCta), matching: find.byType(ZCard)), findsOneWidget);
  });

  testWidgets('a hotel without AI flags gets no forecasts, calendar or energy baseline', (tester) async {
    final store = seededStore();
    final h = store.hotels.get(DemoSeed.hotelId)!;
    store.hotels.put(Hotel(id: h.id, name: h.name, city: h.city, stars: h.stars, roomCount: h.roomCount));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _gm);

    await tester.scrollUntilVisible(find.byType(AssistantCta), 300, scrollable: _pageList);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dashboard.forecast')), findsNothing);

    final router = containerOf(tester).read(routerProvider);
    for (final route in [Routes.forecasts, Routes.calendar]) {
      router.go(route);
      await tester.pumpAndSettle();
      expect(find.byType(AccessDeniedPage), findsOneWidget, reason: route);
    }

    router.go(Routes.energy);
    await tester.pumpAndSettle();
    for (var i = 0; i < 4; i++) {
      await tester.drag(_pageList, const Offset(0, -1500));
      await tester.pumpAndSettle();
    }
    expect(find.byKey(const Key('energy.baseline')), findsNothing);
  });
}
