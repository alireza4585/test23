import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Text (a review and its link) or a CSV file shared to the app from another
/// app (Android share sheet).
class SharedPayload {
  const SharedPayload({required this.text, this.isCsv = false});

  final String text;
  final bool isCsv;
}

/// The share waiting to be opened in the review form or the CSV import.
class PendingShare extends Notifier<SharedPayload?> {
  @override
  SharedPayload? build() => null;

  void put(SharedPayload payload) => state = payload;

  /// Returns the payload once and clears it.
  SharedPayload? take() {
    final p = state;
    state = null;
    return p;
  }
}

final pendingShareProvider = NotifierProvider<PendingShare, SharedPayload?>(PendingShare.new);

/// The Android side (MainActivity.kt, channel `zarin/share`): `initial` returns
/// the share that started the app; `shared` events arrive while it runs.
/// Elsewhere (iOS, web, tests) nothing ever arrives.
class ShareIntake {
  ShareIntake({MethodChannel? channel}) : _channel = channel ?? const MethodChannel('zarin/share');

  final MethodChannel _channel;
  final _controller = StreamController<SharedPayload>.broadcast();
  bool _started = false;

  static const _maxChars = 2 * 1024 * 1024;

  Stream<SharedPayload> get stream => _controller.stream;

  SharedPayload? _parse(Object? raw) {
    if (raw is! Map) return null;
    final text = raw['text'];
    if (text is! String || text.trim().isEmpty || text.length > _maxChars) return null;
    final mime = raw['mime'];
    final csv = mime is String && (mime.contains('csv') || mime.contains('comma-separated'));
    return SharedPayload(text: text, isCsv: csv);
  }

  Future<SharedPayload?> start() async {
    if (_started) return null;
    _started = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'shared') {
        final p = _parse(call.arguments);
        if (p != null) _controller.add(p);
      }
    });
    try {
      return _parse(await _channel.invokeMethod<Object?>('initial'));
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}

final shareIntakeProvider = Provider<ShareIntake>((ref) => ShareIntake());
