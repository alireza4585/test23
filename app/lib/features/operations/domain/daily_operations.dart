import '../../../core/domain/actor.dart';

/// Daily occupancy & revenue figures (entered by front office in the MVP,
/// imported from the PMS once the integration ships).
class DailyOperations {
  const DailyOperations({
    required this.day,
    required this.roomsAvailable,
    required this.roomsOccupied,
    required this.guests,
    required this.roomRevenue,
    this.fnbRevenue = 0,
    this.otherRevenue = 0,
    this.updatedByName,
    this.updatedAt,
    this.financeKnown = true,
    this.financeRecorded = false,
  });

  final DateTime day;
  final int roomsAvailable;
  final int roomsOccupied;
  final int guests;
  final double roomRevenue;
  final double fnbRevenue;
  final double otherRevenue;
  final String? updatedByName;
  final DateTime? updatedAt;

  /// Whether the revenue fields hold this user's view of the day's revenue
  /// (PocketBase: only with finance.view, from dailyFinance). Otherwise they are 0.
  final bool financeKnown;

  /// Revenue has been recorded for the day (visible to recorders who cannot read it).
  final bool financeRecorded;

  /// Occupancy % = occupied / available.
  double get occupancyRate =>
      roomsAvailable == 0 ? 0 : roomsOccupied / roomsAvailable * 100;

  /// ADR — Average Daily Rate = room revenue / rooms sold.
  double get adr => roomsOccupied == 0 ? 0 : roomRevenue / roomsOccupied;

  /// RevPAR — Revenue per Available Room = room revenue / rooms available.
  double get revpar => roomsAvailable == 0 ? 0 : roomRevenue / roomsAvailable;

  double get totalRevenue => roomRevenue + fnbRevenue + otherRevenue;
}

/// Revenue typed for one day. It is recorded write-only: the app never shows
/// the stored value, and a correction is a new entry.
class RevenueEntry {
  const RevenueEntry({required this.roomRevenue, required this.fnbRevenue, required this.otherRevenue});

  final double roomRevenue;
  final double fnbRevenue;
  final double otherRevenue;

  double get total => roomRevenue + fnbRevenue + otherRevenue;
}

abstract interface class OperationsRepository {
  Stream<List<DailyOperations>> watchRange(
    String hotelId, {
    required DateTime from,
    required DateTime to,
  });

  /// Saves occupancy for the day and, with [revenue] (finance.record), the
  /// day's revenue. The revenue fields of [operations] are ignored.
  Future<void> save(String hotelId, DailyOperations operations, Actor actor, {RevenueEntry? revenue});
}
