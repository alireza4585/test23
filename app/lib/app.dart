import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/di/core_providers.dart';
import 'core/l10n/l10n.dart';
import 'core/platform/platform_providers.dart';
import 'core/preferences/preferences.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/application/auth_providers.dart';

class ZarinApp extends ConsumerWidget {
  const ZarinApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final prefs = ref.watch(preferencesProvider);
    return MaterialApp.router(
      title: 'Zarin Hooshmand',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: prefs.themeMode,
      locale: prefs.locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
      builder: (context, child) => SessionGuard(child: child ?? const SizedBox.shrink()),
    );
  }
}

/// Signs the user out after [AppConfig.sessionTimeout] without interaction
/// (shared devices on hotel floors), and routes push-notification taps
/// through the router (and therefore through its permission guard).
class SessionGuard extends ConsumerStatefulWidget {
  const SessionGuard({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<SessionGuard> createState() => _SessionGuardState();
}

class _SessionGuardState extends ConsumerState<SessionGuard> with WidgetsBindingObserver {
  Timer? _timer;
  DateTime _lastActivity = DateTime.now();
  StreamSubscription<String>? _pushRoutes;

  Duration get _timeout => ref.read(appConfigProvider).sessionTimeout;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pushRoutes = ref.read(pushServiceProvider).openedRoutes.listen((route) {
      ref.read(routerProvider).push(route);
    });
    _restart();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _pushRoutes?.cancel();
    super.dispose();
  }

  void _restart() {
    _lastActivity = DateTime.now();
    _timer?.cancel();
    _timer = Timer(_timeout, _expire);
  }

  Future<void> _expire() async {
    if (ref.read(sessionUserProvider) == null) return;
    await ref.read(sessionControllerProvider).signOut(reason: 'timeout');
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (DateTime.now().difference(_lastActivity) >= _timeout) {
        _expire();
      } else {
        _restart();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _restart(),
      child: widget.child,
    );
  }
}
