/// Validation and normalisation of Iranian national ID numbers (کد ملی).
///
/// The 10th digit is a checksum:
///   s = Σ d[i] * (10 - i)   for i in 0..8
///   r = s % 11
///   check = r < 2 ? r : 11 - r
abstract final class IranNationalId {
  static final RegExp _digitsOnly = RegExp(r'^\d{10}$');

  /// Converts Persian / Arabic-Indic digits to ASCII and strips whitespace
  /// and dashes, so users can type on any keyboard layout.
  static String normalize(String input) {
    final buffer = StringBuffer();
    for (final rune in input.runes) {
      final char = String.fromCharCode(rune);
      if (char.trim().isEmpty || char == '-') continue;
      buffer.write(_toAsciiDigit(rune) ?? char);
    }
    return buffer.toString();
  }

  static bool isValid(String input) {
    final value = normalize(input);
    if (!_digitsOnly.hasMatch(value)) return false;
    // All-same-digit numbers pass the checksum but are never issued.
    if (RegExp(r'^(\d)\1{9}$').hasMatch(value)) return false;

    final digits = value.codeUnits.map((c) => c - 48).toList();
    var sum = 0;
    for (var i = 0; i < 9; i++) {
      sum += digits[i] * (10 - i);
    }
    final remainder = sum % 11;
    final check = remainder < 2 ? remainder : 11 - remainder;
    return check == digits[9];
  }

  /// `0012345678` → `001•••••78` for display in lists and audit screens.
  static String mask(String nationalId) {
    final v = normalize(nationalId);
    if (v.length != 10) return v;
    return '${v.substring(0, 3)}•••••${v.substring(8)}';
  }

  static String? _toAsciiDigit(int rune) {
    // Persian digits ۰-۹ (U+06F0..U+06F9), Arabic-Indic ٠-٩ (U+0660..U+0669).
    if (rune >= 0x06F0 && rune <= 0x06F9) {
      return String.fromCharCode(48 + rune - 0x06F0);
    }
    if (rune >= 0x0660 && rune <= 0x0669) {
      return String.fromCharCode(48 + rune - 0x0660);
    }
    return null;
  }
}
