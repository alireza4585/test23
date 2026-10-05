import 'package:flutter/material.dart';

/// Brand palette — "Luxury × Technology × Hospitality".
///
/// Black / charcoal surfaces, metallic greys for secondary information, white
/// for primary content and a champagne gold used *sparingly* (primary action,
/// active navigation, the single most important number on a screen).
abstract final class AppColors {
  // Neutrals (dark)
  static const black = Color(0xFF0A0A0B);
  static const charcoal = Color(0xFF131416);
  static const charcoalRaised = Color(0xFF1A1B1E);
  static const charcoalHigh = Color(0xFF222429);
  static const graphite = Color(0xFF2E3137);
  static const metallic = Color(0xFF8C919A);
  static const silver = Color(0xFFB9BDC4);
  static const ivory = Color(0xFFF4F3EF);

  // Neutrals (light)
  static const paper = Color(0xFFF6F5F1);
  static const paperRaised = Color(0xFFFFFFFF);
  static const paperHigh = Color(0xFFEDEBE5);
  static const ink = Color(0xFF111215);
  static const inkSoft = Color(0xFF5A5F68);
  static const hairline = Color(0xFFDCD9D1);

  // Accent
  static const gold = Color(0xFFC8A25A);
  static const goldBright = Color(0xFFE2C68C);
  static const goldDeep = Color(0xFF94742F);

  // Semantic status colours (dark surfaces). Validated with the dataviz
  // palette checker in the stacked order used by the room-status bar
  // (clean · cleaning · dirty · occupied · out-of-order): CVD separation and
  // normal-vision floor pass; "occupied" is deliberately neutral grey.
  static const success = Color(0xFF36A374);
  static const warning = Color(0xFFCC7D2A);
  static const danger = Color(0xFFD9533F);
  static const info = Color(0xFF4C8DD6);
  static const neutralStatus = Color(0xFF7D828B);

  /// Single-series data colour for charts — distinct from every status hue.
  static const series = Color(0xFF8A86E0);
}

/// Semantic colours that differ between light and dark themes, exposed as a
/// [ThemeExtension] so widgets never hard-code hex values.
@immutable
class StatusPalette extends ThemeExtension<StatusPalette> {
  const StatusPalette({
    required this.success,
    required this.warning,
    required this.danger,
    required this.info,
    required this.neutral,
    required this.accent,
    required this.subtleSurface,
    required this.series,
  });

  final Color success;
  final Color warning;
  final Color danger;
  final Color info;
  final Color neutral;
  final Color accent;
  final Color subtleSurface;

  /// Data colour for single-series charts (never a status colour).
  final Color series;

  static const dark = StatusPalette(
    success: AppColors.success,
    warning: AppColors.warning,
    danger: AppColors.danger,
    info: AppColors.info,
    neutral: AppColors.neutralStatus,
    accent: AppColors.gold,
    subtleSurface: AppColors.charcoalHigh,
    series: AppColors.series,
  );

  static const light = StatusPalette(
    success: Color(0xFF21885C),
    warning: Color(0xFFB5651A),
    danger: Color(0xFFB9412B),
    info: Color(0xFF2F74B5),
    neutral: Color(0xFF6B7079),
    accent: AppColors.goldDeep,
    subtleSurface: AppColors.paperHigh,
    series: Color(0xFF5B55C4),
  );

  @override
  StatusPalette copyWith({
    Color? success,
    Color? warning,
    Color? danger,
    Color? info,
    Color? neutral,
    Color? accent,
    Color? subtleSurface,
    Color? series,
  }) {
    return StatusPalette(
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
      info: info ?? this.info,
      neutral: neutral ?? this.neutral,
      accent: accent ?? this.accent,
      subtleSurface: subtleSurface ?? this.subtleSurface,
      series: series ?? this.series,
    );
  }

  @override
  StatusPalette lerp(StatusPalette? other, double t) {
    if (other == null) return this;
    return StatusPalette(
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      info: Color.lerp(info, other.info, t)!,
      neutral: Color.lerp(neutral, other.neutral, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      subtleSurface: Color.lerp(subtleSurface, other.subtleSurface, t)!,
      series: Color.lerp(series, other.series, t)!,
    );
  }
}

extension StatusPaletteX on BuildContext {
  StatusPalette get status =>
      Theme.of(this).extension<StatusPalette>() ?? StatusPalette.dark;
}
