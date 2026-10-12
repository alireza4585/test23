import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/hotel/application/hotel_providers.dart';
import '../../features/hotel/domain/hotel.dart';
import '../di/core_providers.dart';
import 'routes.dart';

/// Routes switched off for this build or this hotel: the assistant when
/// `ZH_ENABLE_AI_ASSISTANT=false`, forecasts and the calendar of events while
/// the hotel's `forecasts` flag is off. Navigation hides them and the router
/// sends deep links to "access denied".
final disabledRoutesProvider = Provider<Set<String>>((ref) {
  final config = ref.watch(appConfigProvider);
  final settings = ref.watch(hotelSettingsProvider);
  return {
    if (!config.enableAiAssistant) Routes.assistant,
    if (!settings.has(HotelFeature.forecasts)) ...[Routes.forecasts, Routes.calendar],
  };
});
