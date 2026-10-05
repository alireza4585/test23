import 'dart:async';

import 'package:pocketbase/pocketbase.dart';

import '../../core/error/app_failure.dart';

/// Typed reads over a PocketBase record. PocketBase stores "no value" as an
/// empty string / 0 / empty list, so the nullable readers treat those as null.
extension PbRead on RecordModel {
  String str(String key, [String fallback = '']) {
    final v = data[key];
    return v is String ? v : fallback;
  }

  String? strOrNull(String key) {
    final v = data[key];
    return v is String && v.isNotEmpty ? v : null;
  }

  double dbl(String key, [double fallback = 0]) {
    final v = data[key];
    return v is num ? v.toDouble() : fallback;
  }

  double? dblOrNull(String key) {
    final v = data[key];
    return v is num && v != 0 ? v.toDouble() : null;
  }

  int integer(String key, [int fallback = 0]) {
    final v = data[key];
    return v is num ? v.toInt() : fallback;
  }

  bool boolean(String key) => data[key] == true;

  /// PocketBase datetimes look like `2026-10-05 10:00:00.000Z` (UTC).
  DateTime? date(String key) {
    final v = data[key];
    if (v is! String || v.isEmpty) return null;
    return DateTime.tryParse(v)?.toLocal();
  }

  DateTime dateOrNow(String key) => date(key) ?? DateTime.now();

  DateTime get createdAt => date('created') ?? DateTime.now();

  DateTime? get updatedAt => date('updated');

  List<String> strings(String key) {
    final v = data[key];
    return v is List ? v.map((e) => '$e').where((e) => e.isNotEmpty).toList() : const [];
  }

  Map<String, dynamic> obj(String key) {
    final v = data[key];
    return v is Map ? Map<String, dynamic>.from(v) : const {};
  }

  T enumValue<T extends Enum>(String key, List<T> values, T fallback) {
    final name = data[key];
    for (final v in values) {
      if (v.name == name) return v;
    }
    return fallback;
  }
}

/// UTC timestamp in the format PocketBase stores.
String pbDate(DateTime date) => date.toUtc().toIso8601String().replaceFirst('T', ' ');

/// Stable machine code sent by the Zarin hooks (`data.code.code`).
String? pbErrorCode(ClientException e) {
  final data = e.response['data'];
  if (data is Map && data['code'] is Map) {
    final code = (data['code'] as Map)['code'];
    if (code is String) return code;
  }
  return null;
}

/// Translates PocketBase client errors to [AppFailure]s.
AppFailure mapPbError(Object error) {
  if (error is AppFailure) return error;
  if (error is ClientException) {
    final code = pbErrorCode(error);
    final message = error.response['message']?.toString();
    return switch (error.statusCode) {
      0 => error.isAbort ? const UnexpectedFailure('aborted') : NetworkFailure(error.originalError?.toString()),
      400 => ValidationFailure(code ?? 'invalid_request', message),
      401 => SessionExpiredFailure(code ?? message),
      403 when code == 'account_disabled' => AccountDisabledFailure(code),
      403 => PermissionDeniedFailure(code ?? message),
      404 => NotFoundFailure(code ?? message),
      429 => TooManyRequestsFailure(code ?? message),
      >= 500 => NetworkFailure('server ${error.statusCode}: $message'),
      _ => UnexpectedFailure('${error.statusCode}: $message'),
    };
  }
  return UnexpectedFailure(error.toString());
}

Future<T> pbGuard<T>(Future<T> Function() action) async {
  try {
    return await action();
  } catch (e) {
    throw mapPbError(e);
  }
}

/// Live queries: an initial fetch, then a re-fetch whenever PocketBase
/// realtime reports a change matching the same filter. The server applies
/// each collection's view rule to realtime events too, so a user is never
/// notified about records they may not read.
class PbLive {
  PbLive(this.pb);

  final PocketBase pb;

  static const _debounce = Duration(milliseconds: 150);

  Stream<List<RecordModel>> list(
    String collection, {
    String? filter,
    String? sort,
    int limit = 500,
  }) {
    Future<List<RecordModel>> load() async {
      final result = await pb.collection(collection).getList(
        perPage: limit,
        filter: filter,
        sort: sort,
        skipTotal: true,
      );
      return result.items;
    }

    return _live<List<RecordModel>>(
      load: load,
      subscribe: (onChange) => pb.collection(collection).subscribe('*', (_) => onChange(), filter: filter),
    );
  }

  Stream<RecordModel?> one(String collection, String id) {
    Future<RecordModel?> load() async {
      try {
        return await pb.collection(collection).getOne(id);
      } on ClientException catch (e) {
        if (e.statusCode == 404) return null;
        rethrow;
      }
    }

    return _live<RecordModel?>(
      load: load,
      subscribe: (onChange) => pb.collection(collection).subscribe(id, (_) => onChange()),
    );
  }

  Stream<T> _live<T>({
    required Future<T> Function() load,
    required Future<UnsubscribeFunc> Function(void Function() onChange) subscribe,
  }) {
    late final StreamController<T> controller;
    UnsubscribeFunc? unsubscribe;
    Timer? pending;
    var closed = false;

    Future<void> refresh() async {
      try {
        final value = await load();
        if (!closed) controller.add(value);
      } catch (e, st) {
        if (!closed) controller.addError(mapPbError(e), st);
      }
    }

    controller = StreamController<T>(
      onListen: () {
        unawaited(refresh());
        unawaited(() async {
          try {
            final u = await subscribe(() {
              pending?.cancel();
              pending = Timer(_debounce, () => unawaited(refresh()));
            });
            if (closed) {
              unawaited(u().catchError((_) {}));
            } else {
              unsubscribe = u;
            }
          } catch (_) {
            // Realtime unavailable (e.g. offline): the initial snapshot still
            // renders; the SDK reconnects on the next subscription.
          }
        }());
      },
      onCancel: () {
        closed = true;
        pending?.cancel();
        final u = unsubscribe;
        unsubscribe = null;
        if (u != null) unawaited(u().catchError((_) {}));
      },
    );
    return controller.stream;
  }
}
