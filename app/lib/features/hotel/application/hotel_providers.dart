import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/hotel.dart';

final hotelProvider = StreamProvider<Hotel?>((ref) {
  final hotelId = ref.watch(activeHotelIdProvider);
  if (hotelId == null) return Stream.value(null);
  return ref.watch(hotelRepositoryProvider).watchHotel(hotelId);
});

/// Any of the user's hotels by id (for the hotel switch in the profile).
final hotelByIdProvider = StreamProvider.family<Hotel?, String>(
  (ref, hotelId) => ref.watch(hotelRepositoryProvider).watchHotel(hotelId),
);

/// Settings with safe defaults while the hotel document loads.
final hotelSettingsProvider = Provider<HotelSettings>(
  (ref) => ref.watch(hotelProvider).value?.settings ?? const HotelSettings(),
);
