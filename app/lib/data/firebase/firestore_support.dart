import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../core/domain/actor.dart';
import '../../core/error/app_failure.dart';

/// Canonical Firestore paths. Mirrors `docs/03-database-design.md` and
/// `firebase/firestore.rules`.
abstract final class FsPaths {
  static String user(String uid) => 'users/$uid';
  static String inbox(String uid) => 'users/$uid/inbox';
  static String sessions(String uid) => 'users/$uid/sessions';
  static String hotel(String hotelId) => 'hotels/$hotelId';
  static String rooms(String h) => 'hotels/$h/rooms';
  static String tasks(String h) => 'hotels/$h/tasks';
  static String tickets(String h) => 'hotels/$h/maintenanceTickets';
  static String ticketEvents(String h, String t) =>
      'hotels/$h/maintenanceTickets/$t/events';
  static String energy(String h) => 'hotels/$h/energyReadings';
  static String operations(String h) => 'hotels/$h/dailyOperations';
  static String items(String h) => 'hotels/$h/inventoryItems';
  static String movements(String h) => 'hotels/$h/inventoryMovements';
  static String staff(String h) => 'hotels/$h/staff';
  static String shifts(String h) => 'hotels/$h/shifts';
  static String alerts(String h) => 'hotels/$h/alerts';
  static String insights(String h) => 'hotels/$h/aiInsights';
  static String reports(String h) => 'hotels/$h/reports';
  static String roleOverrides(String h) => 'hotels/$h/roleOverrides';
}

typedef Json = Map<String, dynamic>;

extension JsonRead on Json {
  String str(String key, [String fallback = '']) =>
      this[key] is String ? this[key] as String : fallback;

  String? strOrNull(String key) => this[key] is String ? this[key] as String : null;

  double dbl(String key, [double fallback = 0]) =>
      this[key] is num ? (this[key] as num).toDouble() : fallback;

  double? dblOrNull(String key) =>
      this[key] is num ? (this[key] as num).toDouble() : null;

  int integer(String key, [int fallback = 0]) =>
      this[key] is num ? (this[key] as num).toInt() : fallback;

  bool boolean(String key, [bool fallback = false]) =>
      this[key] is bool ? this[key] as bool : fallback;

  DateTime? date(String key) {
    final v = this[key];
    if (v is Timestamp) return v.toDate();
    if (v is DateTime) return v;
    if (v is String) return DateTime.tryParse(v);
    return null;
  }

  /// Server timestamps are `null` in the local snapshot until the write is
  /// acknowledged; fall back to "now" so optimistic UI renders sensibly.
  DateTime dateOrNow(String key) => date(key) ?? DateTime.now();

  List<String> strings(String key) => this[key] is List
      ? (this[key] as List).whereType<String>().toList()
      : const [];

  Json obj(String key) =>
      this[key] is Map ? Map<String, dynamic>.from(this[key] as Map) : const {};

  T enumValue<T extends Enum>(String key, List<T> values, T fallback) {
    final name = this[key];
    for (final v in values) {
      if (v.name == name) return v;
    }
    return fallback;
  }
}

Json actorJson(Actor actor) => actor.toMap();

Timestamp ts(DateTime date) => Timestamp.fromDate(date);

/// Translates Firebase / Functions / Auth exceptions to [AppFailure]s.
AppFailure mapFirebaseError(Object error) {
  if (error is AppFailure) return error;
  if (error is FirebaseAuthException) {
    return switch (error.code) {
      'invalid-credential' ||
      'wrong-password' ||
      'user-not-found' ||
      'invalid-email' => InvalidCredentialsFailure(error.code),
      'user-disabled' => AccountDisabledFailure(error.code),
      'too-many-requests' => TooManyRequestsFailure(error.code),
      'network-request-failed' => NetworkFailure(error.code),
      'requires-recent-login' => SessionExpiredFailure(error.code),
      _ => UnexpectedFailure('${error.code}: ${error.message}'),
    };
  }
  if (error is FirebaseFunctionsException) {
    return switch (error.code) {
      'permission-denied' || 'unauthenticated' => PermissionDeniedFailure(error.message),
      'not-found' => NotFoundFailure(error.message),
      'invalid-argument' ||
      'already-exists' ||
      'failed-precondition' => ValidationFailure(
        (error.details is Map && (error.details as Map)['code'] is String)
            ? (error.details as Map)['code'] as String
            : error.code,
        error.message,
      ),
      'unavailable' || 'deadline-exceeded' => NetworkFailure(error.message),
      'resource-exhausted' => TooManyRequestsFailure(error.message),
      _ => UnexpectedFailure('${error.code}: ${error.message}'),
    };
  }
  if (error is FirebaseException) {
    return switch (error.code) {
      'permission-denied' => PermissionDeniedFailure(error.message),
      'not-found' => NotFoundFailure(error.message),
      'unavailable' || 'deadline-exceeded' => NetworkFailure(error.message),
      'unauthenticated' => SessionExpiredFailure(error.message),
      'resource-exhausted' => TooManyRequestsFailure(error.message),
      _ => UnexpectedFailure('${error.code}: ${error.message}'),
    };
  }
  return UnexpectedFailure(error.toString());
}

Future<T> guard<T>(Future<T> Function() action) async {
  try {
    return await action();
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

extension FailureMappedStream<T> on Stream<T> {
  Stream<T> mapFailures() => transform(
    StreamTransformer<T, T>.fromHandlers(
      handleError: (error, stack, sink) =>
          sink.addError(mapFirebaseError(error), stack),
    ),
  );
}
