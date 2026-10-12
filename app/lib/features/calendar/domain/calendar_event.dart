import 'package:shamsi_date/shamsi_date.dart';

enum CalendarEventKind { publicHoliday, religious, school, localEvent, closure, other }

/// A day (or span) that changes demand: forecasts treat these days as special.
class CalendarEvent {
  const CalendarEvent({
    required this.id,
    required this.day,
    required this.kind,
    required this.title,
    this.endDay,
    this.builtIn = false,
  });

  final String id;
  final DateTime day;
  final DateTime? endDay;
  final CalendarEventKind kind;
  final String title;

  /// Iran's fixed solar holidays, known in code (not stored, not editable).
  final bool builtIn;
}

class CalendarEventDraft {
  const CalendarEventDraft({required this.day, required this.kind, required this.title, this.endDay});

  final DateTime day;
  final DateTime? endDay;
  final CalendarEventKind kind;
  final String title;
}

abstract interface class CalendarRepository {
  Stream<List<CalendarEvent>> watchEvents(String hotelId);

  Future<void> addEvent(String hotelId, CalendarEventDraft draft);

  Future<void> deleteEvent(String hotelId, String eventId);
}

/// Iran's fixed (solar-calendar) public holidays — the same list the server
/// uses (firebase/functions/src/analytics/calendar.ts). Lunar holidays move
/// every year and are entered by the hotel from the official calendar.
const _fixedHolidays = <(int, int, String)>[
  (1, 1, 'نوروز'),
  (1, 2, 'نوروز'),
  (1, 3, 'نوروز'),
  (1, 4, 'نوروز'),
  (1, 12, 'روز جمهوری اسلامی'),
  (1, 13, 'روز طبیعت'),
  (3, 14, 'رحلت امام خمینی'),
  (3, 15, 'قیام ۱۵ خرداد'),
  (11, 22, 'پیروزی انقلاب اسلامی'),
  (12, 29, 'ملی شدن صنعت نفت'),
];

List<CalendarEvent> iranFixedHolidays(DateTime from, DateTime to) {
  final start = DateTime(from.year, from.month, from.day);
  final end = DateTime(to.year, to.month, to.day);
  final out = <CalendarEvent>[];
  for (var jy = Jalali.fromDateTime(start).year; jy <= Jalali.fromDateTime(end).year; jy++) {
    for (final (jm, jd, title) in _fixedHolidays) {
      final g = Jalali(jy, jm, jd).toDateTime();
      final day = DateTime(g.year, g.month, g.day);
      if (!day.isBefore(start) && !day.isAfter(end)) {
        out.add(CalendarEvent(id: 'fixed-$jy-$jm-$jd', day: day, kind: CalendarEventKind.publicHoliday, title: title, builtIn: true));
      }
    }
  }
  return out..sort((a, b) => a.day.compareTo(b.day));
}
