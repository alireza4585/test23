import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'platform_services.dart';

/// Overridden in bootstrap with real implementations; defaults are safe
/// in-memory / no-op versions suitable for tests and the demo backend.
final secureStoreProvider = Provider<SecureStore>((ref) => InMemorySecureStore());

final pushServiceProvider = Provider<PushService>(
  (ref) => const NoopPushService(),
);

final mediaPickerProvider = Provider<MediaPicker>(
  (ref) => ImagePickerMediaPicker(),
);

final deviceInfoServiceProvider = Provider<DeviceInfoService>(
  (ref) => DeviceInfoService(
    ref.watch(secureStoreProvider),
    ref.watch(pushServiceProvider),
  ),
);
