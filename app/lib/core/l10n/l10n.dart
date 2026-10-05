import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:shamsi_date/shamsi_date.dart';

import '../../l10n/generated/app_localizations.dart';

export '../../l10n/generated/app_localizations.dart';

extension L10nX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);

  Formatters get fmt => Formatters(Localizations.localeOf(this).languageCode);
}

/// Locale-aware formatting. Persian uses Persian digits and the Solar Hijri
/// (Jalali) calendar — what Iranian hotel staff actually read — while English
/// uses Gregorian dates and Latin digits.
class Formatters {
  const Formatters(this.languageCode);

  final String languageCode;

  bool get isFa => languageCode == 'fa';

  String digits(String input) {
    if (!isFa) return input;
    const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    final b = StringBuffer();
    for (final c in input.codeUnits) {
      b.write(c >= 48 && c <= 57 ? fa[c - 48] : String.fromCharCode(c));
    }
    return b.toString();
  }

  String number(num value, {int decimals = 0}) {
    final f = NumberFormat.decimalPatternDigits(
      locale: 'en',
      decimalDigits: decimals,
    );
    final formatted = f.format(value);
    if (!isFa) return formatted;
    // Persian thousands (٬) and decimal (٫) separators.
    return digits(formatted.replaceAll(',', '٬').replaceAll('.', '٫'));
  }

  String percent(double value, {int decimals = 0, bool signed = false}) {
    final sign = signed && value > 0 ? '+' : (value < 0 ? '−' : '');
    final body = number(value.abs(), decimals: decimals);
    // LRM keeps the sign attached to the number inside RTL text.
    return isFa ? '\u200E$sign$body٪' : '$sign$body%';
  }

  /// Compact money: 85,000,000 → «۸۵ میلیون» / "85M".
  String money(num value) {
    final v = value.abs();
    final sign = value < 0 ? '−' : '';
    if (v >= 1e9) {
      return '$sign${number(v / 1e9, decimals: v >= 1e10 ? 0 : 1)}${isFa ? ' میلیارد' : 'B'}';
    }
    if (v >= 1e6) {
      return '$sign${number(v / 1e6, decimals: v >= 1e7 ? 0 : 1)}${isFa ? ' میلیون' : 'M'}';
    }
    if (v >= 1e3) {
      return '$sign${number(v / 1e3, decimals: 0)}${isFa ? ' هزار' : 'K'}';
    }
    return '$sign${number(v)}';
  }

  String date(DateTime d) {
    if (isFa) {
      final f = Jalali.fromDateTime(d).formatter;
      return digits('${f.d} ${f.mN} ${f.yyyy}');
    }
    return DateFormat.yMMMd('en').format(d);
  }

  String dateShort(DateTime d) {
    if (isFa) {
      final f = Jalali.fromDateTime(d).formatter;
      return digits('${f.d} ${f.mN}');
    }
    return DateFormat.MMMd('en').format(d);
  }

  /// Day-of-month for chart axes.
  String dayOfMonth(DateTime d) =>
      isFa ? digits(Jalali.fromDateTime(d).day.toString()) : d.day.toString();

  String weekday(DateTime d) {
    if (isFa) return Jalali.fromDateTime(d).formatter.wN;
    return DateFormat.EEEE('en').format(d);
  }

  String time(DateTime d) {
    final hh = d.hour.toString().padLeft(2, '0');
    final mm = d.minute.toString().padLeft(2, '0');
    return digits('$hh:$mm');
  }

  String dateTime(DateTime d) => '${dateShort(d)}، ${time(d)}';

  String relative(DateTime d, DateTime now, AppLocalizations l10n) {
    final diff = now.difference(d);
    if (diff.inMinutes < 1) return l10n.justNow;
    if (diff.inMinutes < 60) return l10n.minutesAgo(digits('${diff.inMinutes}'));
    if (diff.inHours < 24) return l10n.hoursAgo(digits('${diff.inHours}'));
    if (diff.inDays < 7) return l10n.daysAgo(digits('${diff.inDays}'));
    return dateShort(d);
  }
}
