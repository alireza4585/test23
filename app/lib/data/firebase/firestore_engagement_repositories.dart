import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';

import '../../core/domain/actor.dart';
import '../../core/security/app_role.dart';
import '../../features/admin/domain/user_admin.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/reports/domain/report_models.dart';
import 'firestore_support.dart';

// ----------------------------------------------------------- notifications

class FirestoreNotificationsRepository implements NotificationsRepository {
  FirestoreNotificationsRepository(this._db);

  final FirebaseFirestore _db;

  @override
  Stream<List<InboxNotification>> watchInbox(String uid, {int limit = 50}) =>
      _db
          .collection(FsPaths.inbox(uid))
          .orderBy('createdAt', descending: true)
          .limit(limit)
          .snapshots()
          .map(
            (s) => [
              for (final doc in s.docs)
                InboxNotification(
                  id: doc.id,
                  title: doc.data().str('title'),
                  body: doc.data().str('body'),
                  category: doc.data().enumValue(
                    'category',
                    NotificationCategory.values,
                    NotificationCategory.system,
                  ),
                  severity: doc.data().enumValue('severity', AlertSeverity.values, AlertSeverity.info),
                  createdAt: doc.data().dateOrNow('createdAt'),
                  route: doc.data().strOrNull('route'),
                  readAt: doc.data().date('readAt'),
                ),
            ],
          )
          .mapFailures();

  @override
  Future<void> markRead(String uid, String notificationId) => guard(
    () => _db.doc('${FsPaths.inbox(uid)}/$notificationId').update({
      'readAt': FieldValue.serverTimestamp(),
    }),
  );

  @override
  Future<void> markAllRead(String uid) => guard(() async {
    final unread = await _db
        .collection(FsPaths.inbox(uid))
        .where('readAt', isNull: true)
        .limit(400)
        .get();
    final batch = _db.batch();
    for (final doc in unread.docs) {
      batch.update(doc.reference, {'readAt': FieldValue.serverTimestamp()});
    }
    await batch.commit();
  });

  @override
  Stream<List<HotelAlert>> watchAlerts(
    String hotelId, {
    required String roleCode,
    bool openOnly = true,
  }) {
    Query<Json> q = _db
        .collection(FsPaths.alerts(hotelId))
        .where('audienceRoles', arrayContains: roleCode);
    if (openOnly) q = q.where('status', whereIn: ['open', 'acknowledged']);
    return q
        .orderBy('createdAt', descending: true)
        .limit(50)
        .snapshots()
        .map(
          (s) => [
            for (final doc in s.docs)
              HotelAlert(
                id: doc.id,
                type: doc.data().enumValue('type', AlertType.values, AlertType.system),
                severity: doc.data().enumValue('severity', AlertSeverity.values, AlertSeverity.info),
                title: doc.data().str('title'),
                message: doc.data().str('message'),
                status: doc.data().enumValue('status', AlertStatus.values, AlertStatus.open),
                createdAt: doc.data().dateOrNow('createdAt'),
                route: doc.data().strOrNull('route'),
                acknowledgedByName: doc.data().strOrNull('acknowledgedByName'),
              ),
          ]..sort((a, b) {
            final sv = b.severity.index.compareTo(a.severity.index);
            return sv != 0 ? sv : b.createdAt.compareTo(a.createdAt);
          }),
        )
        .mapFailures();
  }

  @override
  Future<void> acknowledgeAlert(String hotelId, String alertId, Actor actor) =>
      guard(
        () => _db.doc('${FsPaths.alerts(hotelId)}/$alertId').update({
          'status': AlertStatus.acknowledged.name,
          'acknowledgedBy': actorJson(actor),
          'acknowledgedByName': actor.name,
          'acknowledgedAt': FieldValue.serverTimestamp(),
        }),
      );
}

// ---------------------------------------------------------------- insights

class FirestoreInsightsRepository implements InsightsRepository {
  FirestoreInsightsRepository(this._db);

  final FirebaseFirestore _db;

  @override
  Stream<List<AiInsight>> watchInsights(
    String hotelId, {
    bool activeOnly = true,
  }) {
    Query<Json> q = _db.collection(FsPaths.insights(hotelId));
    if (activeOnly) q = q.where('status', isEqualTo: InsightStatus.active.name);
    return q
        .orderBy('createdAt', descending: true)
        .limit(30)
        .snapshots()
        .map(
          (s) => [
            for (final doc in s.docs)
              AiInsight(
                id: doc.id,
                category: doc.data().enumValue('category', InsightCategory.values, InsightCategory.energy),
                title: doc.data().str('title'),
                summary: doc.data().str('summary'),
                recommendation: doc.data().str('recommendation'),
                confidence: doc.data().dbl('confidence', 0.5),
                status: doc.data().enumValue('status', InsightStatus.values, InsightStatus.active),
                source: doc.data().str('source', 'ruleEngine'),
                createdAt: doc.data().dateOrNow('createdAt'),
                evidence: doc.data().strings('evidence'),
                estimatedMonthlySaving: doc.data().dblOrNull('estimatedMonthlySaving'),
                route: doc.data().strOrNull('route'),
              ),
          ],
        )
        .mapFailures();
  }

  @override
  Future<void> updateStatus(
    String hotelId,
    String insightId,
    InsightStatus status,
    Actor actor,
  ) => guard(
    () => _db.doc('${FsPaths.insights(hotelId)}/$insightId').update({
      'status': status.name,
      'updatedAt': FieldValue.serverTimestamp(),
      'updatedBy': actorJson(actor),
    }),
  );
}

/// Calls the `aiAssistant` Cloud Function, which grounds the question in the
/// hotel's analytics and forwards it to the configured LLM provider.
class FunctionsAiAssistantRepository implements AiAssistantRepository {
  FunctionsAiAssistantRepository(this._functions);

  final FirebaseFunctions _functions;

  @override
  Future<AssistantReply> ask({
    required String hotelId,
    required String question,
    required List<ChatMessage> history,
    required String localeCode,
  }) => guard(() async {
    final callable = _functions.httpsCallable(
      'aiAssistant',
      options: HttpsCallableOptions(timeout: const Duration(seconds: 90)),
    );
    final result = await callable.call<Map<String, dynamic>>({
      'hotelId': hotelId,
      'question': question,
      'locale': localeCode,
      // Most recent 12 turns.
      'history': [
        for (final m in history.where((m) => !m.isError).toList().reversed.take(12).toList().reversed)
          {'role': m.role.name, 'text': m.text},
      ],
    });
    final data = Map<String, dynamic>.from(result.data);
    return AssistantReply(
      text: data.str('answer'),
      dataPoints: data.strings('dataPoints'),
    );
  });
}

// ----------------------------------------------------------------- reports

class FirestoreReportsRepository implements ReportsRepository {
  FirestoreReportsRepository(this._db, this._storage);

  final FirebaseFirestore _db;
  final FirebaseStorage _storage;

  @override
  Stream<List<ReportRecord>> watchReports(String hotelId, {int limit = 20}) =>
      _db
          .collection(FsPaths.reports(hotelId))
          .orderBy('createdAt', descending: true)
          .limit(limit)
          .snapshots()
          .map(
            (s) => [
              for (final doc in s.docs)
                ReportRecord(
                  id: doc.id,
                  type: doc.data().enumValue('type', ReportType.values, ReportType.executiveSummary),
                  from: doc.data().dateOrNow('from'),
                  to: doc.data().dateOrNow('to'),
                  createdAt: doc.data().dateOrNow('createdAt'),
                  createdByName: doc.data().str('createdByName'),
                  storagePath: doc.data().strOrNull('storagePath'),
                ),
            ],
          )
          .mapFailures();

  @override
  Future<ReportRecord> archive(
    String hotelId, {
    required ReportType type,
    required DateTime from,
    required DateTime to,
    required Uint8List pdfBytes,
    required Actor actor,
  }) => guard(() async {
    final ref = _db.collection(FsPaths.reports(hotelId)).doc();
    final path = 'hotels/$hotelId/reports/${ref.id}.pdf';
    await _storage.ref(path).putData(
      pdfBytes,
      SettableMetadata(contentType: 'application/pdf'),
    );
    await ref.set({
      'type': type.name,
      'from': ts(from),
      'to': ts(to),
      'format': 'pdf',
      'storagePath': path,
      'sizeBytes': pdfBytes.lengthInBytes,
      'createdBy': actorJson(actor),
      'createdByName': actor.name,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return ReportRecord(
      id: ref.id,
      type: type,
      from: from,
      to: to,
      createdAt: DateTime.now(),
      createdByName: actor.name,
      storagePath: path,
    );
  });
}

// ------------------------------------------------------------- user admin

class FirebaseUserAdminRepository implements UserAdminRepository {
  FirebaseUserAdminRepository(this._db, this._functions);

  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;

  /// Hotel directory `hotels/{id}/members` — maintained only by Cloud
  /// Functions, readable by roles with `users.manage`.
  @override
  Stream<List<ManagedUser>> watchUsers(String hotelId) => _db
      .collection('hotels/$hotelId/members')
      .limit(500)
      .snapshots()
      .map(
        (s) => [
          for (final doc in s.docs)
            ManagedUser(
              uid: doc.id,
              fullName: doc.data().str('fullName'),
              nationalIdMasked: doc.data().str('nationalIdMasked'),
              role: AppRole.fromCode(doc.data().strOrNull('role')) ?? AppRole.receptionStaff,
              status: doc.data().enumValue('status', UserStatus.values, UserStatus.active),
              phone: doc.data().strOrNull('phone'),
              lastLoginAt: doc.data().date('lastLoginAt'),
            ),
        ]..sort((a, b) => a.role.index.compareTo(b.role.index)),
      )
      .mapFailures();

  @override
  Future<String> createUser(NewUserRequest request) => guard(() async {
    final result = await _functions
        .httpsCallable('adminCreateUser')
        .call<Map<String, dynamic>>({
          'hotelId': request.hotelId,
          'nationalId': request.nationalId,
          'fullName': request.fullName,
          'phone': request.phone,
          'role': request.role.code,
          'temporaryPassword': request.temporaryPassword,
        });
    return Map<String, dynamic>.from(result.data).str('uid');
  });

  @override
  Future<void> setStatus({
    required String hotelId,
    required String uid,
    required UserStatus status,
  }) => guard(() async {
    await _functions.httpsCallable('adminSetUserStatus').call<void>({
      'hotelId': hotelId,
      'uid': uid,
      'status': status.name,
    });
  });

  @override
  Future<void> resetPassword({
    required String hotelId,
    required String uid,
    required String temporaryPassword,
  }) => guard(() async {
    await _functions.httpsCallable('adminResetPassword').call<void>({
      'hotelId': hotelId,
      'uid': uid,
      'temporaryPassword': temporaryPassword,
    });
  });
}
