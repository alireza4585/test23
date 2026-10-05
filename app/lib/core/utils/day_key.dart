/// Calendar-day helpers. Daily aggregates (energy, occupancy, metrics) are
/// keyed by `yyyy-MM-dd` in the hotel's local time zone, which keeps document
/// IDs deterministic and makes range queries trivial on any backend.
abstract final class DayKey {
  static String of(DateTime date) {
    final d = DateTime(date.year, date.month, date.day);
    final mm = d.month.toString().padLeft(2, '0');
    final dd = d.day.toString().padLeft(2, '0');
    return '${d.year}-$mm-$dd';
  }

  static DateTime parse(String key) {
    final parts = key.split('-').map(int.parse).toList();
    return DateTime(parts[0], parts[1], parts[2]);
  }

  static DateTime startOfDay(DateTime date) =>
      DateTime(date.year, date.month, date.day);

  /// Inclusive list of days between [from] and [to].
  static List<DateTime> range(DateTime from, DateTime to) {
    final start = startOfDay(from);
    final end = startOfDay(to);
    final days = <DateTime>[];
    for (var d = start; !d.isAfter(end); d = DateTime(d.year, d.month, d.day + 1)) {
      days.add(d);
    }
    return days;
  }
}
