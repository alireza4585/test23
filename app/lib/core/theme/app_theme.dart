import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Spacing scale (4-pt grid) and radii shared by all components.
abstract final class Insets {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;

  /// Horizontal page gutter on phones.
  static const page = 16.0;
}

abstract final class Radii {
  static const sm = 8.0;
  static const md = 14.0;
  static const lg = 20.0;
}

/// Responsive breakpoints (Material 3 window size classes).
abstract final class Breakpoints {
  static const compact = 600.0;
  static const medium = 840.0;
  static const expanded = 1200.0;
}

abstract final class AppTheme {
  static const fontFamily = 'Vazirmatn';

  static ThemeData dark() {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: AppColors.gold,
      onPrimary: AppColors.black,
      primaryContainer: Color(0xFF3A3020),
      onPrimaryContainer: AppColors.goldBright,
      secondary: AppColors.silver,
      onSecondary: AppColors.black,
      secondaryContainer: AppColors.graphite,
      onSecondaryContainer: AppColors.ivory,
      tertiary: AppColors.info,
      onTertiary: AppColors.ivory,
      error: AppColors.danger,
      onError: AppColors.ivory,
      surface: AppColors.charcoal,
      onSurface: AppColors.ivory,
      onSurfaceVariant: AppColors.metallic,
      surfaceContainerLowest: AppColors.black,
      surfaceContainerLow: Color(0xFF16171A),
      surfaceContainer: AppColors.charcoalRaised,
      surfaceContainerHigh: AppColors.charcoalHigh,
      surfaceContainerHighest: AppColors.graphite,
      outline: Color(0xFF3A3D44),
      outlineVariant: Color(0xFF26282D),
      inverseSurface: AppColors.ivory,
      onInverseSurface: AppColors.black,
      shadow: Colors.black,
      scrim: Colors.black,
    );
    return _build(scheme, StatusPalette.dark, AppColors.black);
  }

  static ThemeData light() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.goldDeep,
      onPrimary: Colors.white,
      primaryContainer: Color(0xFFF1E4C6),
      onPrimaryContainer: Color(0xFF3B2D0E),
      secondary: AppColors.inkSoft,
      onSecondary: Colors.white,
      secondaryContainer: AppColors.paperHigh,
      onSecondaryContainer: AppColors.ink,
      tertiary: Color(0xFF3B6E99),
      onTertiary: Colors.white,
      error: Color(0xFFAE3F28),
      onError: Colors.white,
      surface: AppColors.paperRaised,
      onSurface: AppColors.ink,
      onSurfaceVariant: AppColors.inkSoft,
      surfaceContainerLowest: Colors.white,
      surfaceContainerLow: Color(0xFFFAF9F6),
      surfaceContainer: AppColors.paper,
      surfaceContainerHigh: AppColors.paperHigh,
      surfaceContainerHighest: Color(0xFFE3E0D8),
      outline: Color(0xFFC9C5BB),
      outlineVariant: AppColors.hairline,
      inverseSurface: AppColors.charcoal,
      onInverseSurface: AppColors.ivory,
      shadow: Colors.black,
      scrim: Colors.black,
    );
    return _build(scheme, StatusPalette.light, AppColors.paper);
  }

  static ThemeData _build(
    ColorScheme scheme,
    StatusPalette status,
    Color scaffold,
  ) {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: scaffold,
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      splashFactory: InkSparkle.splashFactory,
    );

    final text = base.textTheme.apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
      fontFamily: fontFamily,
    );

    final outlineBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.sm),
      borderSide: BorderSide(color: scheme.outline),
    );

    return base.copyWith(
      extensions: [status],
      textTheme: text.copyWith(
        headlineMedium: text.headlineMedium?.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scaffold,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: text.titleLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      cardTheme: CardThemeData(
        color: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        thickness: 1,
        space: 1,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainer,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Insets.lg,
          vertical: Insets.md,
        ),
        border: outlineBorder,
        enabledBorder: outlineBorder,
        focusedBorder: outlineBorder.copyWith(
          borderSide: BorderSide(color: scheme.primary, width: 1.4),
        ),
        errorBorder: outlineBorder.copyWith(
          borderSide: BorderSide(color: scheme.error),
        ),
        labelStyle: TextStyle(color: scheme.onSurfaceVariant),
        floatingLabelStyle: TextStyle(color: scheme.primary),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 52),
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontWeight: FontWeight.w600,
            fontSize: 15,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.sm),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          foregroundColor: scheme.onSurface,
          side: BorderSide(color: scheme.outline),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.sm),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: scheme.primary),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: scheme.surfaceContainer,
        selectedColor: scheme.primaryContainer,
        side: BorderSide(color: scheme.outlineVariant),
        labelStyle: text.labelMedium,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primaryContainer,
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => text.labelSmall?.copyWith(
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w400,
            color: states.contains(WidgetState.selected)
                ? scheme.onSurface
                : scheme.onSurfaceVariant,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.onSurfaceVariant,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        indicatorColor: scheme.primaryContainer,
        selectedIconTheme: IconThemeData(color: scheme.primary),
        unselectedIconTheme: IconThemeData(color: scheme.onSurfaceVariant),
        selectedLabelTextStyle: text.labelMedium?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: text.labelMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainer,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainer,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: text.bodyMedium?.copyWith(
          color: scheme.onInverseSurface,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: scheme.onSurfaceVariant,
        contentPadding: const EdgeInsets.symmetric(horizontal: Insets.lg),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          visualDensity: VisualDensity.compact,
          side: WidgetStatePropertyAll(BorderSide(color: scheme.outline)),
        ),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }
}
