import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Non-sensitive UI preferences (language, theme). Sensitive values go to
/// `SecureStore`.
class AppPreferences {
  const AppPreferences({required this.locale, required this.themeMode});

  final Locale locale;
  final ThemeMode themeMode;

  AppPreferences copyWith({Locale? locale, ThemeMode? themeMode}) =>
      AppPreferences(
        locale: locale ?? this.locale,
        themeMode: themeMode ?? this.themeMode,
      );
}

/// Overridden in bootstrap with an instance loaded before the first frame,
/// so the app starts in the right language without flicker.
final sharedPreferencesProvider = Provider<SharedPreferences?>((ref) => null);

class PreferencesController extends Notifier<AppPreferences> {
  static const _localeKey = 'zh.locale';
  static const _themeKey = 'zh.theme';

  @override
  AppPreferences build() {
    final prefs = ref.watch(sharedPreferencesProvider);
    final code = prefs?.getString(_localeKey) ?? 'fa';
    final theme = prefs?.getString(_themeKey);
    return AppPreferences(
      locale: Locale(code),
      themeMode: ThemeMode.values.firstWhere(
        (m) => m.name == theme,
        orElse: () => ThemeMode.dark,
      ),
    );
  }

  Future<void> setLocale(Locale locale) async {
    state = state.copyWith(locale: locale);
    await ref.read(sharedPreferencesProvider)?.setString(
      _localeKey,
      locale.languageCode,
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = state.copyWith(themeMode: mode);
    await ref.read(sharedPreferencesProvider)?.setString(_themeKey, mode.name);
  }
}

final preferencesProvider =
    NotifierProvider<PreferencesController, AppPreferences>(
      PreferencesController.new,
    );
