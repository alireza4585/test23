/// Morning briefing (AI phase 1, F4): one per role and day, written by the
/// server from the hotel's data (rule-based, or re-worded by an LLM only when
/// every number checked out).
class BriefingItem {
  const BriefingItem({required this.title, required this.finding, this.cause, this.actionId, this.route, this.category = ''});

  final String title;
  final String finding;

  /// Always hedged ("ممکن است مرتبط باشد"), or null.
  final String? cause;
  final String? actionId;
  final String? route;
  final String category;
}

class Briefing {
  const Briefing({
    required this.id,
    required this.day,
    required this.role,
    required this.text,
    required this.source,
    this.items = const [],
    this.myRating,
  });

  final String id;
  final String day;
  final String role;
  final String text;

  /// `rules` | `llm`
  final String source;
  final List<BriefingItem> items;

  /// The signed-in user's rating (true = useful), if any.
  final bool? myRating;
}

abstract interface class BriefingRepository {
  /// Today's briefing for the signed-in user's role, or null.
  Stream<Briefing?> watchToday(String hotelId, String day);

  Future<void> rate(String briefingId, {required bool useful});
}
