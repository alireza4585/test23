import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_failure.dart';
import '../../../core/security/app_permission.dart';
import '../../../data/repository_providers.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/calendar_event.dart';

/// Events entered by the hotel (built-in fixed holidays are added by the page).
final calendarEventsProvider = StreamProvider<List<CalendarEvent>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel) return Stream.value(const []);
  return ref.watch(calendarRepositoryProvider).watchEvents(user.hotelId);
});

class CalendarActions {
  CalendarActions(this.ref);

  final Ref ref;

  bool get canManage => ref.read(sessionUserProvider)?.can(AppPermission.hotelSettings) ?? false;

  Future<void> add(CalendarEventDraft draft) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!canManage) throw const PermissionDeniedFailure('hotel.settings');
    if (draft.title.trim().isEmpty) throw const ValidationFailure('title_required');
    if (draft.endDay != null && draft.endDay!.isBefore(draft.day)) throw const ValidationFailure('invalid_range');
    await ref.read(calendarRepositoryProvider).addEvent(user.hotelId, draft);
  }

  Future<void> delete(CalendarEvent event) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!canManage || event.builtIn) throw const PermissionDeniedFailure('hotel.settings');
    await ref.read(calendarRepositoryProvider).deleteEvent(user.hotelId, event.id);
  }
}

final calendarActionsProvider = Provider<CalendarActions>(CalendarActions.new);
