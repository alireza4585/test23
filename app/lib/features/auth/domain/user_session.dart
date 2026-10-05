/// Information about the current device, gathered by the platform layer.
class DeviceDescriptor {
  const DeviceDescriptor({
    required this.deviceId,
    required this.platform,
    required this.model,
    required this.osVersion,
    required this.appVersion,
    this.pushToken,
  });

  final String deviceId;

  /// `android` | `ios` | `other`.
  final String platform;
  final String model;
  final String osVersion;
  final String appVersion;
  final String? pushToken;
}

class UserSession {
  const UserSession({
    required this.id,
    required this.platform,
    required this.model,
    required this.appVersion,
    required this.createdAt,
    required this.lastSeenAt,
    this.revokedAt,
  });

  final String id;
  final String platform;
  final String model;
  final String appVersion;
  final DateTime createdAt;
  final DateTime lastSeenAt;
  final DateTime? revokedAt;

  bool get isActive => revokedAt == null;
}
