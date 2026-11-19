import 'package:pocketbase/pocketbase.dart';

import '../../features/reviews/domain/review.dart';
import 'pb_support.dart';

double? _num(Object? v) => v is num ? v.toDouble() : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
List<String> _strings(Object? v) => v is List ? [for (final x in v) if (x is String && x.isNotEmpty) x] : const [];
DateTime? _day(String? v) => v == null || v.isEmpty ? null : DateTime.tryParse(v.replaceFirst(' ', 'T'))?.toLocal();
String _dayKey(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// F10 guest reviews on PocketBase: the `reviews`, `reviewSources` and
/// `reviewSurveyTokens` collections (server-written, read under the active
/// hotel's rules) and the `/api/zarin/reviews…` routes for every change.
class PocketBaseReviewsRepository implements ReviewsRepository {
  PocketBaseReviewsRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  Future<dynamic> _post(String path, Map<String, dynamic> body) => pbGuard(() => _pb.send(path, method: 'POST', body: body));

  @override
  Stream<List<GuestReview>> watchReviews(String hotelId) => _live
      .list('reviews', filter: _pb.filter('hotel = {:h} && status = "active"', {'h': hotelId}), sort: '-postedAt,-created', limit: 500)
      .map((records) => [for (final r in records) reviewFromRecord(r)]);

  @override
  Future<List<GuestReview>> queue(String hotelId) async {
    final res = await pbGuard(() => _pb.send('/api/zarin/reviews/queue', query: {'hotel': hotelId})) as Map<String, dynamic>;
    return [
      for (final m in (res['items'] as List? ?? const []).whereType<Map<String, dynamic>>())
        reviewFromMap({...m, 'status': 'needsReview'}),
    ];
  }

  @override
  Future<void> decide(String reviewId, {required bool accept}) =>
      _post('/api/zarin/reviews/$reviewId/decide', {'decision': accept ? 'accept' : 'reject'});

  @override
  Future<ReviewProfile> profile(String hotelId) async =>
      profileFromMap(await pbGuard(() => _pb.send('/api/zarin/reviews/profile', query: {'hotel': hotelId})) as Map<String, dynamic>);

  @override
  Future<ReviewProfile> saveProfile(String hotelId, ReviewProfileUpdate u) async {
    final body = <String, dynamic>{
      'hotel': hotelId,
      if (u.nameFa != null || u.nameEn != null) 'names': {'fa': ?u.nameFa, 'en': ?u.nameEn},
      'aliases': ?u.aliases,
      'city': ?u.city,
      'cityAliases': ?u.cityAliases,
      'negativeKeywords': ?u.negativeKeywords,
      'retentionDays': ?u.retentionDays,
      if (u.publicSurvey != null || u.roomSurvey != null || u.brandName != null)
        'survey': {'publicEnabled': ?u.publicSurvey, 'roomEnabled': ?u.roomSurvey, 'brandName': ?u.brandName},
      if (u.confirmPurge) 'confirmPurge': true,
    };
    try {
      return profileFromMap(await _pb.send('/api/zarin/reviews/profile', method: 'POST', body: body) as Map<String, dynamic>);
    } on ClientException catch (e) {
      if (pbErrorCode(e) == 'retention_confirm_required') {
        final affected = ((e.response['data'] as Map?)?['affected'] as Map?)?['message'];
        throw RetentionConfirmationRequired(int.tryParse('$affected') ?? 0);
      }
      throw mapPbError(e);
    }
  }

  @override
  Stream<List<ReviewListing>> watchListings(String hotelId) => _live
      .list('reviewSources', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), sort: 'platform,created')
      .map((records) => [
            for (final r in records)
              ReviewListing(
                id: r.id,
                platform: r.str('platform'),
                status: r.enumValue('status', ListingStatus.values, ListingStatus.candidate),
                url: r.strOrNull('url'),
                externalId: r.strOrNull('externalId'),
                label: r.strOrNull('label'),
              ),
          ]);

  @override
  Future<void> addListing(String hotelId, {required String url, String? platform, String? label, bool confirm = false}) =>
      _post('/api/zarin/review-sources', {'hotel': hotelId, 'url': url, 'platform': ?platform, 'label': ?label, 'confirm': confirm});

  @override
  Future<void> decideListing(String listingId, {required bool confirm}) =>
      _post('/api/zarin/review-sources/$listingId/decide', {'decision': confirm ? 'confirm' : 'reject'});

  @override
  Future<ImportResult> importCsv(String hotelId, String csv, {String? platform, bool dryRun = true}) async =>
      importResultFromMap(await _post('/api/zarin/reviews/import', {'hotel': hotelId, 'csv': csv, 'platform': ?platform, 'dryRun': dryRun}) as Map<String, dynamic>);

  @override
  Future<ReviewStatus> add(String hotelId, ReviewDraft d) async {
    final res = await _post('/api/zarin/reviews', {
      'hotel': hotelId,
      'channel': d.channel.wire,
      'text': d.text,
      if (d.url != null && d.url!.isNotEmpty) 'url': d.url,
      'platform': ?d.platform,
      if (d.postedAt != null) 'postedAt': _dayKey(d.postedAt!),
      'rating': ?d.rating,
      'scaleMax': ?d.scaleMax,
    }) as Map<String, dynamic>;
    return res['status'] == 'needsReview' ? ReviewStatus.needsReview : ReviewStatus.active;
  }

  @override
  Future<ReviewReadiness> readiness(String hotelId) async {
    final res = await _post('/api/zarin/reviews/dry-run', {'hotel': hotelId}) as Map<String, dynamic>;
    final c = (res['checks'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ReviewReadiness(
      profileSaved: c['profileSaved'] == true,
      names: c['names'] == true,
      city: c['city'] == true,
      listingsConfirmed: _int(c['listingsConfirmed']),
      surveyPublicToken: c['surveyPublicToken'] == true,
      surveyRoomTokens: _int(c['surveyRoomTokens']),
      surveyConfigured: c['surveyConfigured'] == true,
      feature: c['feature'] == true,
    );
  }

  @override
  Stream<List<SurveyToken>> watchSurveyTokens(String hotelId) {
    Future<List<SurveyToken>> load() async {
      final list = await _pb.collection('reviewSurveyTokens').getFullList(
        filter: _pb.filter('hotel = {:h} && active = true', {'h': hotelId}),
        expand: 'room',
        sort: 'kind,created',
      );
      final out = [
        for (final r in list)
          SurveyToken(
            id: r.id,
            kind: r.str('kind') == 'room' ? SurveyTokenKind.room : SurveyTokenKind.public,
            token: r.str('token'),
            url: surveyUrl(r.str('token')),
            roomId: r.strOrNull('room'),
            roomNumber: r.get<String>('expand.room.number', ''),
            rotatedAt: r.date('rotatedAt'),
            printedAt: r.date('printedAt'),
          ),
      ];
      out.sort((a, b) => a.kind != b.kind
          ? a.kind.index.compareTo(b.kind.index)
          : (int.tryParse(a.roomNumber ?? '') ?? 0).compareTo(int.tryParse(b.roomNumber ?? '') ?? 0));
      return out;
    }

    return _live
        .list('reviewSurveyTokens', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), limit: 1)
        .asyncMap((_) => load());
  }

  /// The survey page on this server (the QR card's link).
  String surveyUrl(String token) => '${_pb.baseURL.replaceFirst(RegExp(r'/+$'), '')}/survey/$token';

  @override
  Future<void> createSurveyTokens(String hotelId, SurveyTokenKind kind) =>
      _post('/api/zarin/reviews/survey/tokens', {'hotel': hotelId, 'kind': kind.name});

  @override
  Future<void> rotateSurveyToken(String tokenId) => _post('/api/zarin/reviews/survey/tokens/$tokenId/rotate', {});

  @override
  Future<void> markPrinted(String hotelId, List<String> tokenIds) =>
      _post('/api/zarin/reviews/survey/printed', {'hotel': hotelId, 'ids': tokenIds});
}

GuestReview reviewFromRecord(RecordModel r) => reviewFromMap({...r.data, 'id': r.id});

GuestReview reviewFromMap(Map<String, dynamic> m) {
  String? s(String k) => m[k] is String && (m[k] as String).isNotEmpty ? m[k] as String : null;
  final rating = _num(m['rating5']);
  return GuestReview(
    id: m['id'] as String? ?? '',
    platform: s('platform') ?? 'other',
    channel: ReviewChannel.fromWire(s('channel')),
    status: ReviewStatus.values.firstWhere((x) => x.name == m['status'], orElse: () => ReviewStatus.active),
    text: m['text'] as String? ?? '',
    title: s('title'),
    url: s('url'),
    rating5: rating == null || rating == 0 ? null : rating,
    ratingRaw: _num(m['ratingRaw']),
    scaleMax: _num(m['scaleMax']),
    postedAt: _day(s('postedAt')),
    editedAt: _day(s('editedAt')),
    matchReasons: _strings(m['matchReasons']),
    duplicateOf: s('duplicateOf'),
    textPurged: s('textPurgedAt') != null,
    listingId: s('listing'),
    lang: s('lang'),
    createdAt: _day(s('created')),
  );
}

ReviewProfile profileFromMap(Map<String, dynamic> m) {
  final names = (m['names'] as Map?)?.cast<String, dynamic>() ?? const {};
  final survey = (m['survey'] as Map?)?.cast<String, dynamic>() ?? const {};
  final toggles = (m['toggles'] as Map?)?.cast<String, dynamic>() ?? const {};
  final onboarding = (m['onboarding'] as Map?)?.cast<String, dynamic>() ?? const {};
  return ReviewProfile(
    saved: m['id'] is String,
    feature: m['feature'] == true,
    nameFa: names['fa'] as String? ?? '',
    nameEn: names['en'] as String? ?? '',
    aliases: _strings(m['aliases']),
    city: m['city'] as String? ?? '',
    cityAliases: _strings(m['cityAliases']),
    negativeKeywords: _strings(m['negativeKeywords']),
    retentionDays: _int(m['retentionDays']) == 0 ? 365 : _int(m['retentionDays']),
    survey: ReviewSurveySettings(
      languages: _strings(survey['languages']),
      brandName: survey['brandName'] as String? ?? '',
      publicEnabled: survey['publicEnabled'] == true,
      roomEnabled: survey['roomEnabled'] == true,
    ),
    showEstimated: toggles['showEstimated'] == true,
    onboarding: {for (final e in onboarding.entries) if (e.value is String) e.key: e.value as String},
  );
}

ImportResult importResultFromMap(Map<String, dynamic> m) => ImportResult(
  dryRun: m['dryRun'] != false,
  rows: _int(m['rows']),
  created: _int(m['created']),
  updated: _int(m['updated']),
  edited: _int(m['edited']),
  unchanged: _int(m['unchanged']),
  needsReview: _int(m['needsReview']),
  crossPosts: _int(m['crossPosts']),
  errors: [
    for (final e in (m['errors'] as List? ?? const []).whereType<Map<String, dynamic>>())
      (_int(e['row']), e['reason'] as String? ?? ''),
  ],
  preview: [
    for (final p in (m['preview'] as List? ?? const []).whereType<Map<String, dynamic>>())
      ImportPreviewRow(
        row: _int(p['row']),
        outcome: p['outcome'] as String? ?? '',
        status: p['status'] as String? ?? '',
        platform: p['platform'] as String? ?? 'other',
        rating5: _num(p['rating5']),
        text: p['text'] as String? ?? '',
        crossPost: p['crossPost'] == true,
      ),
  ],
);
