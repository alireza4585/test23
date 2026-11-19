import 'dart:async';

import '../../core/error/app_failure.dart';
import '../../core/security/app_permission.dart';
import '../../core/security/role_policy.dart';
import '../../features/hotel/domain/hotel.dart';
import '../../features/reviews/domain/review.dart';
import 'demo_collection.dart';
import 'demo_store.dart';

class _State {
  final reviews = DemoCollection<GuestReview>((r) => r.id);
  final listings = DemoCollection<ReviewListing>((l) => l.id);
  final tokens = DemoCollection<SurveyToken>((t) => t.id);
  ReviewProfileUpdate profile = const ReviewProfileUpdate();
  bool saved = false;
  bool seeded = false;
}

final _states = Expando<_State>();

/// Offline demo of F10 R1. It shows the flow (import with a preview, the
/// review queue, listings, QR cards); redaction and matching are the
/// server's and only roughly imitated here.
class DemoReviewsRepository implements ReviewsRepository {
  DemoReviewsRepository(this._store);

  final DemoStore _store;

  _State get _s => _states[_store] ??= _State();

  DemoAccount get _me {
    final uid = _store.signedInUid;
    final me = uid == null ? null : _store.accountByUid(uid);
    if (me == null) throw const SessionExpiredFailure();
    return me;
  }

  void _require(String hotelId, AppPermission p, {bool flag = true}) {
    if (!RolePolicy.resolve(_me.role).contains(p)) throw const PermissionDeniedFailure();
    if (flag && !(_store.hotels.get(hotelId)?.settings.has(HotelFeature.guestReviews) ?? false)) {
      throw const ValidationFailure('feature_disabled');
    }
  }

  void _seed() {
    if (_s.seeded) return;
    _s.seeded = true;
    final now = _store.clock.now();
    final samples = <(String, ReviewChannel, double?, String, int)>[
      ('booking', ReviewChannel.csv, 4.56, 'اتاق خیلی تمیز بود. صبحانه متنوع و تازه بود.', 2),
      ('google', ReviewChannel.csv, 2, 'صدای خیابان تا صبح می‌آمد. کارکنان مهربان بودند.', 4),
      ('instagram', ReviewChannel.staffShare, null, 'تخت راحت بود و موقعیت هتل عالی بود. [link]', 5),
      ('survey', ReviewChannel.surveyRoom, 4, 'آب گرم همیشه برقرار بود.', 1),
      ('survey', ReviewChannel.surveyPublic, 3, '', 3),
      ('snapptrip', ReviewChannel.csv, 1, 'صبحانه سرد بود و کسی پاسخ نداد.', 7),
    ];
    var i = 0;
    for (final (platform, channel, rating, text, daysAgo) in samples) {
      i++;
      _s.reviews.put(GuestReview(
        id: 'rv-demo-$i', platform: platform, channel: channel, status: ReviewStatus.active, text: text,
        rating5: rating, postedAt: now.subtract(Duration(days: daysAgo)), lang: 'fa',
        url: platform == 'instagram' ? 'https://www.instagram.com/p/demo$i/' : null,
      ));
    }
    _s.reviews.put(GuestReview(
      id: 'rv-demo-q', platform: 'google', channel: ReviewChannel.csv, status: ReviewStatus.needsReview,
      text: 'شعبهٔ شهر دیگر این هتل بهتر بود.', rating5: 3, postedAt: now.subtract(const Duration(days: 2)),
      matchReasons: const ['negative:شهر دیگر'],
    ));
  }

  @override
  Stream<List<GuestReview>> watchReviews(String hotelId) {
    _seed();
    return _s.reviews.watch(
      where: (r) => r.status == ReviewStatus.active,
      sort: (a, b) => (b.postedAt ?? DateTime(0)).compareTo(a.postedAt ?? DateTime(0)),
    );
  }

  @override
  Future<List<GuestReview>> queue(String hotelId) async {
    _require(hotelId, AppPermission.reviewsManage);
    _seed();
    return _s.reviews.query(where: (r) => r.status == ReviewStatus.needsReview);
  }

  GuestReview _with(GuestReview r, ReviewStatus status) => GuestReview(
    id: r.id, platform: r.platform, channel: r.channel, status: status, text: r.text, title: r.title, url: r.url,
    rating5: r.rating5, postedAt: r.postedAt, matchReasons: r.matchReasons, lang: r.lang,
  );

  @override
  Future<void> decide(String reviewId, {required bool accept}) async {
    final r = _s.reviews.get(reviewId);
    if (r == null) throw const NotFoundFailure();
    await _store.latency();
    _s.reviews.put(_with(r, accept ? ReviewStatus.active : ReviewStatus.rejected));
  }

  @override
  Future<ReviewProfile> profile(String hotelId) async {
    _require(hotelId, AppPermission.reviewsView, flag: false);
    final hotel = _store.hotels.get(hotelId);
    final p = _s.profile;
    return ReviewProfile(
      saved: _s.saved,
      feature: hotel?.settings.has(HotelFeature.guestReviews) ?? false,
      nameFa: p.nameFa ?? hotel?.name ?? '',
      nameEn: p.nameEn ?? '',
      aliases: p.aliases ?? const [],
      city: p.city ?? hotel?.city ?? '',
      cityAliases: p.cityAliases ?? const [],
      negativeKeywords: p.negativeKeywords ?? const [],
      retentionDays: p.retentionDays ?? 365,
      survey: ReviewSurveySettings(publicEnabled: p.publicSurvey ?? false, roomEnabled: p.roomSurvey ?? false, brandName: p.brandName ?? ''),
    );
  }

  @override
  Future<ReviewProfile> saveProfile(String hotelId, ReviewProfileUpdate u) async {
    _require(hotelId, AppPermission.reviewsManage, flag: false);
    final before = await profile(hotelId);
    if (u.retentionDays != null && (u.retentionDays! < 1 || u.retentionDays! > 730)) throw const ValidationFailure('invalid_field');
    if (u.retentionDays != null && u.retentionDays! < before.retentionDays && !u.confirmPurge) {
      throw RetentionConfirmationRequired(
        _s.reviews.query(where: (r) => r.text.isNotEmpty && (r.postedAt?.isBefore(_store.clock.now().subtract(Duration(days: u.retentionDays!))) ?? false)).length,
      );
    }
    final p = _s.profile;
    _s.profile = ReviewProfileUpdate(
      nameFa: u.nameFa ?? p.nameFa, nameEn: u.nameEn ?? p.nameEn, aliases: u.aliases ?? p.aliases, city: u.city ?? p.city,
      cityAliases: u.cityAliases ?? p.cityAliases, negativeKeywords: u.negativeKeywords ?? p.negativeKeywords,
      retentionDays: u.retentionDays ?? p.retentionDays, publicSurvey: u.publicSurvey ?? p.publicSurvey,
      roomSurvey: u.roomSurvey ?? p.roomSurvey, brandName: u.brandName ?? p.brandName,
    );
    _s.saved = true;
    await _store.latency();
    return profile(hotelId);
  }

  @override
  Stream<List<ReviewListing>> watchListings(String hotelId) => _s.listings.watch();

  @override
  Future<void> addListing(String hotelId, {required String url, String? platform, String? label, bool confirm = false}) async {
    _require(hotelId, AppPermission.reviewsManage, flag: false);
    if (_s.listings.all.any((l) => l.url == url)) throw const ValidationFailure('source_exists');
    await _store.latency();
    _s.listings.put(ReviewListing(
      id: _store.nextId('rs'), platform: platform ?? guessReviewPlatform(url), url: url, label: label,
      status: confirm ? ListingStatus.confirmed : ListingStatus.candidate,
    ));
  }

  @override
  Future<void> decideListing(String listingId, {required bool confirm}) async {
    final l = _s.listings.get(listingId);
    if (l == null) throw const NotFoundFailure();
    await _store.latency();
    _s.listings.put(ReviewListing(
      id: l.id, platform: l.platform, url: l.url, label: l.label, externalId: l.externalId,
      status: confirm ? ListingStatus.confirmed : ListingStatus.rejected,
    ));
  }

  @override
  Future<ImportResult> importCsv(String hotelId, String csv, {String? platform, bool dryRun = true}) async {
    _require(hotelId, AppPermission.reviewsManage, flag: !dryRun);
    final lines = csv.trim().split(RegExp(r'\r?\n'));
    if (lines.length < 2) throw const ValidationFailure('csv_required');
    final rows = lines.skip(1).where((l) => l.trim().isNotEmpty).toList();
    final preview = <ImportPreviewRow>[];
    var row = 0;
    for (final l in rows) {
      row++;
      final text = l.split(',').where((c) => c.trim().length > 3).join(' ');
      preview.add(ImportPreviewRow(row: row, outcome: 'created', status: 'active', platform: platform ?? 'other', text: text));
      if (!dryRun) {
        _s.reviews.put(GuestReview(
          id: _store.nextId('rv'), platform: platform ?? 'other', channel: ReviewChannel.csv, status: ReviewStatus.active,
          text: text, postedAt: _store.clock.now(),
        ));
      }
    }
    await _store.latency();
    return ImportResult(dryRun: dryRun, rows: rows.length, created: rows.length, preview: dryRun ? preview : const []);
  }

  @override
  Future<ReviewStatus> add(String hotelId, ReviewDraft d) async {
    _require(hotelId, AppPermission.reviewsManage);
    if (d.text.trim().isEmpty && d.rating == null) throw const ValidationFailure('no_text_or_rating');
    await _store.latency();
    final scale = d.scaleMax ?? 5;
    _s.reviews.put(GuestReview(
      id: _store.nextId('rv'), platform: d.platform ?? guessReviewPlatform(d.url), channel: d.channel, status: ReviewStatus.active,
      text: d.text.replaceAll(RegExp(r'''https?://[^\s<>"']+'''), '[link]'), url: d.url,
      rating5: d.rating == null ? null : ((d.rating! - 1) / (scale - 1) * 4 + 1), postedAt: d.postedAt ?? _store.clock.now(),
    ));
    return ReviewStatus.active;
  }

  @override
  Future<ReviewReadiness> readiness(String hotelId) async {
    final p = await profile(hotelId);
    return ReviewReadiness(
      profileSaved: p.saved,
      names: p.nameFa.isNotEmpty || p.nameEn.isNotEmpty,
      city: p.city.isNotEmpty,
      listingsConfirmed: _s.listings.all.where((l) => l.status == ListingStatus.confirmed).length,
      surveyPublicToken: _s.tokens.all.any((t) => t.kind == SurveyTokenKind.public),
      surveyRoomTokens: _s.tokens.all.where((t) => t.kind == SurveyTokenKind.room).length,
      surveyConfigured: true,
      feature: p.feature,
    );
  }

  String _url(String token) => 'https://demo.invalid/survey/$token';

  @override
  Stream<List<SurveyToken>> watchSurveyTokens(String hotelId) => _s.tokens.watch(
    sort: (a, b) => a.kind != b.kind
        ? a.kind.index.compareTo(b.kind.index)
        : (int.tryParse(a.roomNumber ?? '') ?? 0).compareTo(int.tryParse(b.roomNumber ?? '') ?? 0),
  );

  @override
  Future<void> createSurveyTokens(String hotelId, SurveyTokenKind kind) async {
    _require(hotelId, AppPermission.reviewsManage);
    final now = _store.clock.now();
    if (kind == SurveyTokenKind.public) {
      if (_s.tokens.all.any((t) => t.kind == SurveyTokenKind.public)) return;
      final token = 'demo${now.microsecondsSinceEpoch}';
      _s.tokens.put(SurveyToken(id: 'st-public', kind: kind, token: token, url: _url(token), rotatedAt: now));
      return;
    }
    for (final room in _store.rooms.all) {
      if (_s.tokens.get('st-${room.id}') != null) continue;
      final token = 'demo${room.number}x${now.microsecondsSinceEpoch}';
      _s.tokens.put(SurveyToken(id: 'st-${room.id}', kind: kind, token: token, url: _url(token), roomId: room.id, roomNumber: room.number, rotatedAt: now));
    }
  }

  @override
  Future<void> rotateSurveyToken(String tokenId) async {
    final t = _s.tokens.get(tokenId);
    if (t == null) throw const NotFoundFailure();
    final now = _store.clock.now();
    final token = 'demo${now.microsecondsSinceEpoch}';
    _s.tokens.put(SurveyToken(id: t.id, kind: t.kind, token: token, url: _url(token), roomId: t.roomId, roomNumber: t.roomNumber, rotatedAt: now, printedAt: t.printedAt));
  }

  @override
  Future<void> markPrinted(String hotelId, List<String> tokenIds) async {
    final now = _store.clock.now().add(const Duration(seconds: 1));
    for (final id in tokenIds) {
      final t = _s.tokens.get(id);
      if (t == null) continue;
      _s.tokens.put(SurveyToken(id: t.id, kind: t.kind, token: t.token, url: t.url, roomId: t.roomId, roomNumber: t.roomNumber, rotatedAt: t.rotatedAt, printedAt: now));
    }
  }
}
