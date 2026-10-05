import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/notification_models.dart';

final inboxProvider = StreamProvider<List<InboxNotification>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null) return Stream.value(const []);
  return ref.watch(notificationsRepositoryProvider).watchInbox(user.uid);
});

final unreadCountProvider = Provider<int>((ref) {
  final inbox = ref.watch(inboxProvider).value ?? const [];
  return inbox.where((n) => n.isUnread).length;
});

/// Open / acknowledged alerts addressed to the user's role.
final alertsProvider = StreamProvider<List<HotelAlert>>((ref) {
  final user = ref.watch(sessionUserProvider);
  final hotelId = ref.watch(activeHotelIdProvider);
  if (user == null || hotelId == null) return Stream.value(const []);
  return ref
      .watch(notificationsRepositoryProvider)
      .watchAlerts(hotelId, roleCode: user.role.code);
});
