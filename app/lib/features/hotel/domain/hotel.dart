/// A tenant of the platform. All operational data lives under
/// `hotels/{hotelId}/…` so that tenant isolation is structural.
class Hotel {
  const Hotel({
    required this.id,
    required this.name,
    required this.city,
    required this.stars,
    required this.roomCount,
    this.timezone = 'Asia/Tehran',
    this.currency = 'IRR',
    this.settings = const HotelSettings(),
  });

  final String id;
  final String name;
  final String city;
  final int stars;
  final int roomCount;
  final String timezone;
  final String currency;
  final HotelSettings settings;
}

/// Per-hotel operating parameters used by analytics and automations.
class HotelSettings {
  const HotelSettings({
    this.energyDailyBaseline = const {
      'electricity': 2400,
      'water': 38,
      'gas': 310,
    },
    this.energyTariff = const {
      'electricity': 3200,
      'water': 21000,
      'gas': 4100,
    },
    this.energyAlertThresholdPct = 15,
    this.maintenanceSlaHours = const {
      'critical': 2,
      'high': 8,
      'medium': 24,
      'low': 72,
    },
    this.targetCleanMinutes = const {
      'checkoutClean': 35,
      'stayoverClean': 20,
      'deepClean': 90,
      'inspection': 10,
      'turndown': 10,
    },
    this.sessionTimeoutMinutes = 30,
  });

  /// Expected daily consumption per energy type (kWh / m³).
  final Map<String, double> energyDailyBaseline;

  /// Unit price per energy type in hotel currency.
  final Map<String, double> energyTariff;

  /// Deviation from baseline that raises an energy alert.
  final double energyAlertThresholdPct;

  /// Resolution SLA per ticket priority.
  final Map<String, int> maintenanceSlaHours;

  /// Target duration per housekeeping task type (minutes).
  final Map<String, int> targetCleanMinutes;

  final int sessionTimeoutMinutes;
}

abstract interface class HotelRepository {
  Stream<Hotel?> watchHotel(String hotelId);
}
