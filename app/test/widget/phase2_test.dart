import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/data/repository_providers.dart';
import 'package:zarin_hooshmand/features/actions/domain/ai_action.dart';
import 'package:zarin_hooshmand/features/energy/presentation/energy_page.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';
import 'package:zarin_hooshmand/features/inventory/domain/purchase_order.dart';

import '../helpers/test_app.dart';

String _nid(AppRole role) => DemoSeed.accounts.firstWhere((a) => a.$3 == role).$2;

bool _isVertical(Widget w) => w is Scrollable && w.axisDirection == AxisDirection.down;
Finder get _pageList => find.byWidgetPredicate(_isVertical).last;

Future<void> _open(WidgetTester tester, String route) async {
  containerOf(tester).read(routerProvider).go(route);
  await tester.pumpAndSettle();
}

Future<void> _switchUser(WidgetTester tester, AppRole role) async {
  await containerOf(tester).read(authRepositoryProvider).signOut();
  await tester.pumpAndSettle();
  await signIn(tester, _nid(role));
}

Future<void> _ask(WidgetTester tester, String question) async {
  await _open(tester, Routes.assistant);
  await tester.enterText(find.byKey(const Key('assistant.input')), question);
  await tester.tap(find.byKey(const Key('assistant.send')));
  await tester.pumpAndSettle();
}

/// Taps [f] after bringing it into view (and clearing snackbars that may cover it).
Future<void> _tap(WidgetTester tester, Finder f) async {
  tester.state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger).first).clearSnackBars();
  await tester.pumpAndSettle();
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> _tapVisible(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: _pageList);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('assistant v2: sources as chips (markers stripped) that open the record page', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    await _ask(tester, 'مصرف برق چطور است؟');
    expect(find.byKey(const Key('assistant.source.s1')), findsOneWidget);
    expect(find.textContaining('[s1]'), findsNothing);
    await _tap(tester, find.byKey(const Key('assistant.source.s1')));
    expect(find.byType(EnergyPage), findsOneWidget);
  });

  testWidgets('assistant v2: convert an answer into a proposed action for a department', (tester) async {
    final store = seededStore();
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.generalManager));
    await _ask(tester, 'خرابی‌ها چه وضعی دارند؟');
    await _tap(tester, find.byKey(const Key('assistant.toAction')));
    await _tap(tester, find.byKey(const Key('assistant.toAction.maintenance')));
    final proposed = store.actions.all.where((a) => a.id.startsWith('act-assistant-')).toList();
    expect(proposed, hasLength(1));
    expect(proposed.single.type, ActionType.notifyRole);
    expect(proposed.single.status, ActionStatus.proposed);
    expect(proposed.single.department, ActionDepartment.maintenance);
    expect(proposed.single.params['roles'], ['maintenanceManager']);
  });

  testWidgets('assistant without the v2 flag: no sources and no convert button', (tester) async {
    final store = seededStore();
    final h = store.hotels.get(DemoSeed.hotelId)!;
    store.hotels.put(Hotel(id: h.id, name: h.name, city: h.city, stars: h.stars, roomCount: h.roomCount, settings: HotelSettings(features: {...HotelFeature.values}..remove(HotelFeature.assistantV2))));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.generalManager));
    await _ask(tester, 'مصرف برق چطور است؟');
    expect(find.byKey(const Key('assistant.source.s1')), findsNothing);
    expect(find.byKey(const Key('assistant.toAction')), findsNothing);
  });

  testWidgets('F5: the inventory manager edits and approves a draft; the GM gives the second approval; receipt adds stock', (tester) async {
    final store = seededStore();
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.inventoryManager));
    await _open(tester, Routes.inventory);
    final po = store.purchaseOrders.get('po-demo-1')!;
    expect(po.status, PurchaseOrderStatus.draft);
    // No finance.view: the card shows no amount.
    expect(find.textContaining('جمع:'), findsNothing);
    final line = po.lines.first;

    // Edit a quantity.
    await _tapVisible(tester, find.byKey(const Key('po.po-demo-1.edit')));
    await tester.enterText(find.byKey(Key('po.line.${line.itemId}')), '7');
    await _tap(tester, find.byKey(const Key('po.save')));
    expect(store.purchaseOrders.get('po-demo-1')!.lines.first.quantity, 7);

    // First approval: the action; with no hotel limit the GM must approve again.
    await _tapVisible(tester, find.byKey(const Key('po.po-demo-1.approve')));
    expect(store.purchaseOrders.get('po-demo-1')!.status, PurchaseOrderStatus.awaitingApproval);
    expect(store.actions.get('act-replenishment-demo')!.status, ActionStatus.executed);
    expect(find.byKey(const Key('po.po-demo-1.second.approve')), findsNothing);

    await _switchUser(tester, AppRole.generalManager);
    await _open(tester, Routes.inventory);
    // The GM sees revenue, and so the order's total.
    expect(find.textContaining('جمع:'), findsOneWidget);
    await _tapVisible(tester, find.byKey(const Key('po.po-demo-1.second.approve')));
    expect(store.purchaseOrders.get('po-demo-1')!.status, PurchaseOrderStatus.approved);
    expect(store.purchaseOrders.get('po-demo-1')!.approvals.map((a) => a.step), [1, 2]);

    // Receipt: two arrive instead of seven.
    final before = store.items.get(line.itemId)!.quantity;
    await _tapVisible(tester, find.byKey(const Key('po.po-demo-1.receive')));
    await tester.enterText(find.byKey(Key('po.line.${line.itemId}')), '2');
    await _tap(tester, find.byKey(const Key('po.save')));
    expect(store.items.get(line.itemId)!.quantity, before + 2);
    expect(store.purchaseOrders.get('po-demo-1')!.status, PurchaseOrderStatus.received);
    expect(find.byKey(const Key('po.po-demo-1')), findsNothing);
  });

  testWidgets('F5: the order\'s first approver may not give the second one', (tester) async {
    final store = seededStore();
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.inventoryManager));
    await _open(tester, Routes.inventory);
    await _tapVisible(tester, find.byKey(const Key('po.po-demo-1.approve')));
    final repo = containerOf(tester).read(purchaseOrdersRepositoryProvider);
    await _switchUser(tester, AppRole.generalManager);
    // Rejecting needs a reason; the order is then cancelled.
    await expectLater(repo.secondApproval('po-demo-1', approve: false), throwsA(anything));
    await repo.secondApproval('po-demo-1', approve: false, note: 'بودجهٔ ماه تمام شده');
    expect(store.purchaseOrders.get('po-demo-1')!.status, PurchaseOrderStatus.cancelled);
  });

  testWidgets('F5: without the replenishment flag there is no order section', (tester) async {
    final store = seededStore();
    final h = store.hotels.get(DemoSeed.hotelId)!;
    store.hotels.put(Hotel(id: h.id, name: h.name, city: h.city, stars: h.stars, roomCount: h.roomCount, settings: HotelSettings(features: {...HotelFeature.values}..remove(HotelFeature.replenishment))));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.inventoryManager));
    await _open(tester, Routes.inventory);
    expect(find.byKey(const Key('po.po-demo-1')), findsNothing);
    expect(store.purchaseOrders.all, isEmpty);
  });
}
