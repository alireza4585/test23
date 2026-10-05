import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/backend.dart';
import '../config/app_config.dart';
import '../utils/clock.dart';

/// Overridden in `bootstrap.dart` (and in tests) — the app never reads
/// environment or constructs infrastructure anywhere else.
final appConfigProvider = Provider<AppConfig>(
  (ref) => throw UnimplementedError('appConfigProvider must be overridden'),
);

final backendProvider = Provider<Backend>(
  (ref) => throw UnimplementedError('backendProvider must be overridden'),
);

final clockProvider = Provider<Clock>((ref) => const Clock());
