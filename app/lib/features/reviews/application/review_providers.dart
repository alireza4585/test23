import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../../hotel/application/hotel_providers.dart';
import '../../hotel/domain/hotel.dart';
import '../domain/review.dart';

/// The active hotel's id when the user may read reviews and the flag is on.
final _reviewsHotelProvider = Provider<String?>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.reviewsView)) return null;
  if (!ref.watch(hotelSettingsProvider).has(HotelFeature.guestReviews)) return null;
  return user.hotelId;
});

final canManageReviewsProvider = Provider<bool>(
  (ref) => ref.watch(_reviewsHotelProvider) != null && (ref.watch(sessionUserProvider)?.can(AppPermission.reviewsManage) ?? false),
);

final reviewsProvider = StreamProvider<List<GuestReview>>((ref) {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null) return Stream.value(const []);
  return ref.watch(reviewsRepositoryProvider).watchReviews(hotelId);
});

final reviewQueueProvider = FutureProvider.autoDispose<List<GuestReview>>((ref) async {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null || !ref.watch(canManageReviewsProvider)) return const [];
  return ref.watch(reviewsRepositoryProvider).queue(hotelId);
});

final reviewProfileProvider = FutureProvider.autoDispose<ReviewProfile?>((ref) async {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null) return null;
  return ref.watch(reviewsRepositoryProvider).profile(hotelId);
});

final reviewListingsProvider = StreamProvider.autoDispose<List<ReviewListing>>((ref) {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null) return Stream.value(const []);
  return ref.watch(reviewsRepositoryProvider).watchListings(hotelId);
});

final surveyTokensProvider = StreamProvider.autoDispose<List<SurveyToken>>((ref) {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null || !ref.watch(canManageReviewsProvider)) return Stream.value(const []);
  return ref.watch(reviewsRepositoryProvider).watchSurveyTokens(hotelId);
});

final reviewReadinessProvider = FutureProvider.autoDispose<ReviewReadiness?>((ref) async {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null || !ref.watch(canManageReviewsProvider)) return null;
  return ref.watch(reviewsRepositoryProvider).readiness(hotelId);
});

final reviewDigestProvider = StreamProvider.autoDispose<ReviewDigest?>((ref) {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null) return Stream.value(null);
  return ref.watch(reviewsRepositoryProvider).watchDigest(hotelId);
});

final reviewAspectsProvider = StreamProvider.autoDispose<Map<String, List<ReviewAspect>>>((ref) {
  final hotelId = ref.watch(_reviewsHotelProvider);
  if (hotelId == null) return Stream.value(const {});
  return ref.watch(reviewsRepositoryProvider).watchAspects(hotelId);
});

final reviewActionsProvider = Provider<ReviewActions>(ReviewActions.new);

/// Every change goes through here (the server checks it all again).
class ReviewActions {
  ReviewActions(this.ref);

  final Ref ref;

  String get _hotelId {
    final id = ref.read(_reviewsHotelProvider);
    if (id == null) throw const PermissionDeniedFailure('reviews');
    return id;
  }

  ReviewsRepository get _repo => ref.read(reviewsRepositoryProvider);

  Future<void> decide(String reviewId, {required bool accept}) async {
    await _repo.decide(reviewId, accept: accept);
    ref.invalidate(reviewQueueProvider);
  }

  Future<ReviewProfile> saveProfile(ReviewProfileUpdate update) async {
    final p = await _repo.saveProfile(_hotelId, update);
    ref
      ..invalidate(reviewProfileProvider)
      ..invalidate(reviewQueueProvider)
      ..invalidate(reviewReadinessProvider);
    return p;
  }

  Future<void> addListing(String url, {String? platform, String? label, bool confirm = false}) async {
    await _repo.addListing(_hotelId, url: url.trim(), platform: platform, label: label, confirm: confirm);
    ref
      ..invalidate(reviewQueueProvider)
      ..invalidate(reviewReadinessProvider);
  }

  Future<void> decideListing(String listingId, {required bool confirm}) async {
    await _repo.decideListing(listingId, confirm: confirm);
    ref
      ..invalidate(reviewQueueProvider)
      ..invalidate(reviewReadinessProvider);
  }

  Future<ImportResult> importCsv(String csv, {String? platform, required bool dryRun}) async {
    if (csv.trim().isEmpty) throw const ValidationFailure('csv_required');
    final r = await _repo.importCsv(_hotelId, csv, platform: platform, dryRun: dryRun);
    if (!dryRun) ref.invalidate(reviewQueueProvider);
    return r;
  }

  Future<AddReviewResult> add(ReviewDraft draft) async {
    if (draft.text.trim().isEmpty && draft.rating == null) throw const ValidationFailure('no_text_or_rating');
    final s = await _repo.add(_hotelId, draft);
    ref.invalidate(reviewQueueProvider);
    return s;
  }

  Future<void> createSurveyTokens(SurveyTokenKind kind) async {
    await _repo.createSurveyTokens(_hotelId, kind);
    ref.invalidate(reviewReadinessProvider);
  }

  Future<void> rotateSurveyToken(String id) => _repo.rotateSurveyToken(id);

  Future<void> markPrinted(List<String> ids) => _repo.markPrinted(_hotelId, ids);

  Future<String> rotateInboundAddress() async {
    final a = await _repo.rotateInboundAddress(_hotelId);
    ref.invalidate(reviewProfileProvider);
    return a;
  }
}
