/// Guest reviews (F10, R1; flag `guestReviews`). No AI in R1: intake (CSV,
/// manual entry, share-to-app, QR survey), matching to the hotel, the review
/// queue, listings and the survey's QR cards. The server is the authority for
/// every rule (redaction, matching, de-duplication, permissions).
library;

/// Where a review came in. Reports count staff-captured reviews and the two
/// survey kinds separately.
enum ReviewChannel {
  csv('csv'),
  manual('manual'),
  staffShare('staff_share'),
  email('email'),
  surveyPublic('survey_public'),
  surveyRoom('survey_room'),
  seed('seed');

  const ReviewChannel(this.wire);
  final String wire;

  static ReviewChannel fromWire(String? v) => values.firstWhere((c) => c.wire == v, orElse: () => ReviewChannel.manual);

  bool get isSurvey => this == surveyPublic || this == surveyRoom;
  bool get isStaffCaptured => this == staffShare || this == manual;
}

enum ReviewStatus { active, needsReview, rejected, deleted, archived }

/// Platforms the server knows (same list as the server's REVIEW_PLATFORMS).
const reviewPlatforms = [
  'booking', 'expedia', 'google', 'tripadvisor', 'instagram', 'telegram',
  'snapptrip', 'jabama', 'eghamat24', 'alibaba', 'survey', 'other',
];

class GuestReview {
  const GuestReview({
    required this.id,
    required this.platform,
    required this.channel,
    required this.status,
    required this.text,
    this.title,
    this.url,
    this.rating5,
    this.ratingRaw,
    this.scaleMax,
    this.postedAt,
    this.editedAt,
    this.matchReasons = const [],
    this.duplicateOf,
    this.textPurged = false,
    this.listingId,
    this.lang,
    this.createdAt,
  });

  final String id;
  final String platform;
  final ReviewChannel channel;
  final ReviewStatus status;

  /// Redacted by the server (no phone, e-mail, national ID, handle or link).
  /// Empty after the hotel's retention period ([textPurged]).
  final String text;
  final String? title;

  /// Link to the review on its platform (opened in the browser, never fetched).
  final String? url;

  /// The rating on 1–5 (null: no rating given).
  final double? rating5;
  final double? ratingRaw;
  final double? scaleMax;
  final DateTime? postedAt;
  final DateTime? editedAt;
  final List<String> matchReasons;

  /// Set when the same guest posted the same review on another platform: counted once.
  final String? duplicateOf;
  final bool textPurged;
  final String? listingId;
  final String? lang;
  final DateTime? createdAt;
}

class ReviewSurveySettings {
  const ReviewSurveySettings({
    this.languages = const ['fa', 'en'],
    this.brandName = '',
    this.publicEnabled = false,
    this.roomEnabled = false,
  });

  final List<String> languages;
  final String brandName;
  final bool publicEnabled;
  final bool roomEnabled;
}

class ReviewProfile {
  const ReviewProfile({
    required this.saved,
    required this.feature,
    this.nameFa = '',
    this.nameEn = '',
    this.aliases = const [],
    this.city = '',
    this.cityAliases = const [],
    this.negativeKeywords = const [],
    this.retentionDays = 365,
    this.survey = const ReviewSurveySettings(),
    this.showEstimated = false,
    this.onboarding = const {},
    this.inboundAddress = '',
    this.mailConfigured = false,
  });

  /// A profile record exists (otherwise these are the defaults from the hotel).
  final bool saved;

  /// The hotel's `guestReviews` flag.
  final bool feature;
  final String nameFa;
  final String nameEn;
  final List<String> aliases;
  final String city;
  final List<String> cityAliases;
  final List<String> negativeKeywords;
  final int retentionDays;
  final ReviewSurveySettings survey;
  final bool showEstimated;

  /// Onboarding steps done (`profile`, `listings`, `dryRunAt` → when).
  final Map<String, String> onboarding;

  /// Where the hotel forwards review-site notification mails (managers only; empty until created).
  final String inboundAddress;

  /// The platform's reviews mail domain is set on the server.
  final bool mailConfigured;
}

/// A change to the profile; null fields stay as they are.
class ReviewProfileUpdate {
  const ReviewProfileUpdate({
    this.nameFa,
    this.nameEn,
    this.aliases,
    this.city,
    this.cityAliases,
    this.negativeKeywords,
    this.retentionDays,
    this.publicSurvey,
    this.roomSurvey,
    this.brandName,
    this.confirmPurge = false,
  });

  final String? nameFa;
  final String? nameEn;
  final List<String>? aliases;
  final String? city;
  final List<String>? cityAliases;
  final List<String>? negativeKeywords;
  final int? retentionDays;
  final bool? publicSurvey;
  final bool? roomSurvey;
  final String? brandName;

  /// Needed to shorten retention: older texts are then removed for good.
  final bool confirmPurge;

  ReviewProfileUpdate withConfirmPurge() => ReviewProfileUpdate(
    nameFa: nameFa, nameEn: nameEn, aliases: aliases, city: city, cityAliases: cityAliases,
    negativeKeywords: negativeKeywords, retentionDays: retentionDays, publicSurvey: publicSurvey,
    roomSurvey: roomSurvey, brandName: brandName, confirmPurge: true,
  );
}

/// Shortening retention removes [affected] review texts at the next nightly run.
class RetentionConfirmationRequired implements Exception {
  const RetentionConfirmationRequired(this.affected);
  final int affected;
}

enum ListingStatus { candidate, confirmed, rejected }

/// The hotel's page on a platform. Only a confirmed listing decides a match.
class ReviewListing {
  const ReviewListing({required this.id, required this.platform, required this.status, this.url, this.externalId, this.label});

  final String id;
  final String platform;
  final ListingStatus status;
  final String? url;
  final String? externalId;
  final String? label;
}

enum SurveyTokenKind { public, room }

/// A QR card: the hotel's public card, or one per room whose token changes at
/// every check-out (the card needs printing again).
class SurveyToken {
  const SurveyToken({
    required this.id,
    required this.kind,
    required this.token,
    required this.url,
    this.roomId,
    this.roomNumber,
    this.rotatedAt,
    this.printedAt,
  });

  final String id;
  final SurveyTokenKind kind;
  final String token;

  /// The survey page this card opens.
  final String url;
  final String? roomId;
  final String? roomNumber;
  final DateTime? rotatedAt;
  final DateTime? printedAt;

  bool get needsPrint => printedAt == null || (rotatedAt != null && rotatedAt!.isAfter(printedAt!));
}

/// One review typed in or shared from another app.
class ReviewDraft {
  const ReviewDraft({
    required this.channel,
    required this.text,
    this.url,
    this.platform,
    this.postedAt,
    this.rating,
    this.scaleMax,
  });

  /// [ReviewChannel.manual] or [ReviewChannel.staffShare].
  final ReviewChannel channel;
  final String text;
  final String? url;
  final String? platform;
  final DateTime? postedAt;
  final double? rating;
  final double? scaleMax;
}

class ImportPreviewRow {
  const ImportPreviewRow({required this.row, required this.outcome, required this.status, required this.platform, this.rating5, this.text = '', this.crossPost = false});

  final int row;

  /// created | updated | unchanged
  final String outcome;
  final String status;
  final String platform;
  final double? rating5;
  final String text;
  final bool crossPost;
}

class ImportResult {
  const ImportResult({
    required this.dryRun,
    this.rows = 0,
    this.created = 0,
    this.updated = 0,
    this.edited = 0,
    this.unchanged = 0,
    this.needsReview = 0,
    this.crossPosts = 0,
    this.errors = const [],
    this.preview = const [],
  });

  final bool dryRun;
  final int rows;
  final int created;
  final int updated;
  final int edited;
  final int unchanged;
  final int needsReview;
  final int crossPosts;

  /// (row, reason) pairs: rows that could not be read.
  final List<(int, String)> errors;
  final List<ImportPreviewRow> preview;
}

/// What onboarding still needs (the dry run saves nothing).
class ReviewReadiness {
  const ReviewReadiness({
    required this.profileSaved,
    required this.names,
    required this.city,
    required this.listingsConfirmed,
    required this.surveyPublicToken,
    required this.surveyRoomTokens,
    required this.surveyConfigured,
    required this.feature,
    this.clientIpVisible = true,
  });

  final bool profileSaved;
  final bool names;
  final bool city;
  final int listingsConfirmed;
  final bool surveyPublicToken;
  final int surveyRoomTokens;
  final bool surveyConfigured;
  final bool feature;

  /// False behind a proxy whose forwarding header PocketBase does not trust:
  /// every guest would share one address, so the survey stays closed.
  final bool clientIpVisible;
}

/// What happened to a review sent from the app.
class AddReviewResult {
  const AddReviewResult(this.status, {this.linkRemoved = false});

  final ReviewStatus status;

  /// The link pointed to a person's profile, not the review: not stored.
  final bool linkRemoved;
}

/// One aspect the analysis found in a review (the 15-key taxonomy).
class ReviewAspect {
  const ReviewAspect(this.aspect, {required this.positive});

  final String aspect;
  final bool positive;
}

/// A score shown only from its minimum number of reviews: [value] is null below [needs].
class ReviewScore {
  const ReviewScore({this.value, this.n = 0, this.needs = 0});

  final double? value;
  final int n;
  final int needs;
}

class ReviewTheme {
  const ReviewTheme({required this.aspect, required this.positive, required this.count});

  final String aspect;
  final bool positive;
  final int count;
}

/// The daily summary (rule-built). The rated average and the estimated
/// satisfaction are separate scores and are never blended.
class ReviewDigest {
  const ReviewDigest({
    required this.day,
    this.newCount = 0,
    this.byGroup = const {},
    this.rated = const ReviewScore(),
    this.ratedByGroup = const {},
    this.estimated,
    this.themes = const [],
    this.backlog = 0,
  });

  final String day;
  final int newCount;

  /// sites | staff | inStay | publicQr
  final Map<String, int> byGroup;
  final ReviewScore rated;
  final Map<String, ReviewScore> ratedByGroup;

  /// Null unless the hotel opted in to see it.
  final ReviewScore? estimated;
  final List<ReviewTheme> themes;
  final int backlog;
}

abstract interface class ReviewsRepository {
  /// Accepted reviews, newest first (reviews.view in the active hotel).
  Stream<List<GuestReview>> watchReviews(String hotelId);

  /// Reviews waiting for a decision (reviews.manage).
  Future<List<GuestReview>> queue(String hotelId);

  /// accept → counted; reject → left out.
  Future<void> decide(String reviewId, {required bool accept});

  Future<ReviewProfile> profile(String hotelId);

  /// Throws [RetentionConfirmationRequired] when a shorter retention needs confirming.
  Future<ReviewProfile> saveProfile(String hotelId, ReviewProfileUpdate update);

  Stream<List<ReviewListing>> watchListings(String hotelId);
  Future<void> addListing(String hotelId, {required String url, String? platform, String? label, bool confirm = false});
  Future<void> decideListing(String listingId, {required bool confirm});

  /// CSV in the generic format; with [dryRun] nothing is saved.
  Future<ImportResult> importCsv(String hotelId, String csv, {String? platform, bool dryRun = true});

  /// The review's status (active or needsReview) and whether its link was dropped.
  Future<AddReviewResult> add(String hotelId, ReviewDraft draft);

  Future<ReviewReadiness> readiness(String hotelId);

  /// The latest daily summary, if any.
  Stream<ReviewDigest?> watchDigest(String hotelId);

  /// Aspects found per review id (recent reviews).
  Stream<Map<String, List<ReviewAspect>>> watchAspects(String hotelId);

  Stream<List<SurveyToken>> watchSurveyTokens(String hotelId);
  Future<void> createSurveyTokens(String hotelId, SurveyTokenKind kind);
  Future<void> rotateSurveyToken(String tokenId);
  Future<void> markPrinted(String hotelId, List<String> tokenIds);

  /// A new forwarding address for review mails (the old one stops); returns it ('' without a mail domain).
  Future<String> rotateInboundAddress(String hotelId);
}

/// The platform a shared link points to (editable in the form). Mirrors the
/// server's guessPlatform.
String guessReviewPlatform(String? url) {
  if (url == null || url.isEmpty) return 'other';
  final host = Uri.tryParse(url)?.host.toLowerCase() ?? '';
  if (host.isEmpty) return 'other';
  bool on(String domain) => host == domain || host.endsWith('.$domain');
  if (on('instagram.com') || on('instagr.am')) return 'instagram';
  if (on('t.me') || on('telegram.me') || on('telegram.org')) return 'telegram';
  if (host == 'maps.app.goo.gl' || on('goo.gl') || on('g.co')) return 'google';
  if (RegExp(r'(^|\.)google\.[a-z.]+$').hasMatch(host)) {
    final path = Uri.tryParse(url)?.path ?? '';
    return host.startsWith('maps.') || path.startsWith('/maps') ? 'google' : 'other';
  }
  if (on('booking.com')) return 'booking';
  if (RegExp(r'(^|\.)expedia\.[a-z.]+$').hasMatch(host) || on('hotels.com')) return 'expedia';
  if (RegExp(r'(^|\.)tripadvisor\.[a-z.]+$').hasMatch(host)) return 'tripadvisor';
  if (on('snapptrip.com')) return 'snapptrip';
  if (on('jabama.com')) return 'jabama';
  if (on('eghamat24.com')) return 'eghamat24';
  if (on('alibaba.ir')) return 'alibaba';
  return 'other';
}

/// The first http(s) link in a shared text.
String? firstLink(String text) {
  final m = RegExp(r'''https?://[^\s<>"']+''', caseSensitive: false).firstMatch(text);
  return m?.group(0)?.replaceFirst(RegExp(r'[).,،]+$'), '');
}
