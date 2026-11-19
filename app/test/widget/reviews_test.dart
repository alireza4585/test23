import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zarin_hooshmand/core/routing/app_router.dart';
import 'package:zarin_hooshmand/core/routing/navigation.dart';
import 'package:zarin_hooshmand/core/routing/route_features.dart';
import 'package:zarin_hooshmand/core/routing/routes.dart';
import 'package:zarin_hooshmand/core/security/app_role.dart';
import 'package:zarin_hooshmand/data/demo/demo_seed.dart';
import 'package:zarin_hooshmand/data/repository_providers.dart';
import 'package:zarin_hooshmand/features/auth/application/auth_providers.dart';
import 'package:zarin_hooshmand/features/auth/presentation/auth_misc_pages.dart';
import 'package:zarin_hooshmand/features/hotel/domain/hotel.dart';
import 'package:zarin_hooshmand/features/reviews/application/share_intake.dart';
import 'package:zarin_hooshmand/features/reviews/domain/review.dart';
import 'package:zarin_hooshmand/features/reviews/presentation/review_form_pages.dart';
import 'package:zarin_hooshmand/features/reviews/presentation/reviews_page.dart';

import '../helpers/test_app.dart';

String _nid(AppRole role) => DemoSeed.accounts.firstWhere((a) => a.$3 == role).$2;

Future<void> _open(WidgetTester tester, String route) async {
  containerOf(tester).read(routerProvider).go(route);
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, Finder f) async {
  tester.state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger).first).clearSnackBars();
  await tester.pumpAndSettle();
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  group('links and shares', () {
    test('the platform is guessed from a shared link like the server does', () {
      expect(guessReviewPlatform('https://www.instagram.com/p/abc/'), 'instagram');
      expect(guessReviewPlatform('https://maps.app.goo.gl/xyz'), 'google');
      expect(guessReviewPlatform('https://www.google.com/maps/place/x'), 'google');
      expect(guessReviewPlatform('https://www.google.com/search?q=x'), 'other');
      expect(guessReviewPlatform('https://t.me/somechannel/12'), 'telegram');
      expect(guessReviewPlatform('https://www.booking.com/hotel/ir/x.html'), 'booking');
      expect(guessReviewPlatform(null), 'other');
      expect(firstLink('این نظر را ببین: https://t.me/c/1/2، ممنون'), 'https://t.me/c/1/2');
    });

    test('share intake: the start-up share, later shares, CSV by type', () async {
      const channel = MethodChannel('zarin/share-test');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'initial') return {'text': 'id,text\n1,خوب', 'mime': 'text/csv'};
        return null;
      });
      final intake = ShareIntake(channel: channel);
      final first = await intake.start();
      expect(first?.isCsv, isTrue);
      final next = intake.stream.first;
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.handlePlatformMessage(
        'zarin/share-test',
        const StandardMethodCodec().encodeMethodCall(const MethodCall('shared', {'text': 'عالی https://t.me/x/1', 'mime': 'text/plain'})),
        (_) {},
      );
      final p = await next;
      expect(p.isCsv, isFalse);
      expect(p.text, contains('t.me'));
    });
  });

  testWidgets('flag off: no reviews in the menu, the route is closed', (tester) async {
    final store = seededStore();
    final h = store.hotels.all.first;
    store.hotels.put(Hotel(id: h.id, name: h.name, city: h.city, stars: h.stars, roomCount: h.roomCount,
        settings: HotelSettings(features: {...HotelFeature.values}..remove(HotelFeature.guestReviews))));
    await pumpZarinApp(tester, store: store);
    await signIn(tester, _nid(AppRole.generalManager));
    final c = containerOf(tester);
    final items = RoleExperience.destinationsFor(c.read(sessionUserProvider)!, disabled: c.read(disabledRoutesProvider)).map((d) => d.item);
    expect(items, isNot(contains(NavItem.reviews)));
    await _open(tester, Routes.reviews);
    expect(find.byType(AccessDeniedPage), findsOneWidget);
  });

  testWidgets('view-only role: the list without manager tabs; reception has no access', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.inventoryManager));
    await _open(tester, Routes.reviews);
    expect(find.byType(ReviewsPage), findsOneWidget);
    expect(find.byType(TabBar), findsNothing);
    expect(find.byType(ReviewTile), findsWidgets);
    expect(find.byType(FloatingActionButton), findsNothing);
    await _open(tester, Routes.reviewsImport);
    expect(find.byType(AccessDeniedPage), findsOneWidget);

    await containerOf(tester).read(authRepositoryProvider).signOut();
    await tester.pumpAndSettle();
    await signIn(tester, _nid(AppRole.receptionStaff));
    await _open(tester, Routes.reviews);
    expect(find.byType(AccessDeniedPage), findsOneWidget);
  });

  testWidgets('manager: filters by channel, decides the queue', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    await _open(tester, Routes.reviews);
    final all = tester.widgetList(find.byType(ReviewTile)).length;
    await _tap(tester, find.byKey(const ValueKey('rv-filter-inStay')));
    expect(tester.widgetList(find.byType(ReviewTile)).length, lessThan(all));
    await _tap(tester, find.byKey(const ValueKey('rv-filter-all')));

    await _tap(tester, find.byType(Tab).at(1));
    expect(find.byKey(const ValueKey('rv-accept-rv-demo-q')), findsOneWidget);
    await _tap(tester, find.byKey(const ValueKey('rv-accept-rv-demo-q')));
    final repo = containerOf(tester).read(reviewsRepositoryProvider);
    expect(await repo.queue(containerOf(tester).read(sessionUserProvider)!.hotelId), isEmpty);
  });

  testWidgets('share-to-app: a shared Instagram text opens a filled form, saved as staff-captured', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    final c = containerOf(tester);
    c.read(pendingShareProvider.notifier).put(const SharedPayload(text: 'تخت راحت بود https://www.instagram.com/p/AbC/'));
    await _open(tester, Routes.reviewsAdd);
    expect(find.byType(ReviewAddPage), findsOneWidget);
    expect(find.byKey(const ValueKey('rv-add-platform-instagram')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('rv-add-url'))).controller!.text, 'https://www.instagram.com/p/AbC/');
    expect(tester.widget<TextField>(find.byKey(const ValueKey('rv-add-text'))).controller!.text, 'تخت راحت بود');
    await _tap(tester, find.byKey(const ValueKey('rv-add-save')));
    final reviews = await c.read(reviewsRepositoryProvider).watchReviews(c.read(sessionUserProvider)!.hotelId).first;
    final saved = reviews.firstWhere((r) => r.url == 'https://www.instagram.com/p/AbC/');
    expect(saved.channel, ReviewChannel.staffShare);
    expect(saved.platform, 'instagram');
    expect(c.read(pendingShareProvider), isNull);
  });

  testWidgets('CSV import: preview first, then import', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    await _open(tester, Routes.reviewsImport);
    expect(find.byType(ReviewImportPage), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('rv-import-csv')), 'id,text\nr1,صبحانه عالی بود\nr2,اتاق تمیز بود\n');
    await _tap(tester, find.byKey(const ValueKey('rv-import-preview')));
    expect(find.byKey(const ValueKey('rv-import-commit')), findsOneWidget);
    final c = containerOf(tester);
    final hotelId = c.read(sessionUserProvider)!.hotelId;
    final before = (await c.read(reviewsRepositoryProvider).watchReviews(hotelId).first).length;
    await _tap(tester, find.byKey(const ValueKey('rv-import-commit')));
    expect((await c.read(reviewsRepositoryProvider).watchReviews(hotelId).first).length, before + 2);
  });

  testWidgets('settings: a shorter retention asks for confirmation; listings; QR cards to print', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.generalManager));
    await _open(tester, Routes.reviews);
    await _tap(tester, find.byType(Tab).at(2));
    await tester.enterText(find.byKey(const ValueKey('rv-retention')), '30');
    await _tap(tester, find.byKey(const ValueKey('rv-save-profile')));
    expect(find.byType(AlertDialog), findsOneWidget);
    await _tap(tester, find.widgetWithText(FilledButton, 'تأیید'));
    final c = containerOf(tester);
    final hotelId = c.read(sessionUserProvider)!.hotelId;
    expect((await c.read(reviewsRepositoryProvider).profile(hotelId)).retentionDays, 30);

    await tester.enterText(find.byKey(const ValueKey('rv-listing-url')), 'https://www.booking.com/hotel/ir/demo.html');
    await _tap(tester, find.byKey(const ValueKey('rv-listing-add')));
    final listings = await c.read(reviewsRepositoryProvider).watchListings(hotelId).first;
    expect(listings.single.platform, 'booking');
    expect(listings.single.status, ListingStatus.confirmed);

    await _tap(tester, find.byType(Tab).at(3));
    await _tap(tester, find.byKey(const ValueKey('rv-qr-create-rooms')));
    expect(find.byKey(const ValueKey('rv-qr-need-print')), findsOneWidget);
    final tokens = await c.read(reviewsRepositoryProvider).watchSurveyTokens(hotelId).first;
    expect(tokens.where((t) => t.kind == SurveyTokenKind.room && t.needsPrint), isNotEmpty);
  });

  testWidgets('summary card: a score below its minimum n says "not enough", never a number; aspects on reviews', (tester) async {
    await pumpZarinApp(tester);
    await signIn(tester, _nid(AppRole.inventoryManager));
    await _open(tester, Routes.reviews);
    expect(find.byKey(const ValueKey('rv-digest')), findsOneWidget);
    expect(find.textContaining('هنوز کافی نیست (۴ از ۵)'), findsOneWidget);
    expect(find.byKey(const ValueKey('rv-digest-estimated')), findsNothing);
    expect(find.textContaining('صبحانه و غذا −'), findsWidgets);
    expect(find.textContaining('نظافت +'), findsOneWidget);
  });
}

