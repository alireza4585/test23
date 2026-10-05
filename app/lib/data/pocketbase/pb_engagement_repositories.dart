import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:pocketbase/pocketbase.dart';

import '../../core/domain/actor.dart';
import '../../features/ai/domain/ai_models.dart';
import '../../features/notifications/domain/notification_models.dart';
import '../../features/reports/domain/report_models.dart';
import 'pb_support.dart';

// ----------------------------------------------------------- notifications

class PocketBaseNotificationsRepository implements NotificationsRepository {
  PocketBaseNotificationsRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<List<InboxNotification>> watchInbox(String uid, {int limit = 50}) => _live
      .list('inbox', filter: _pb.filter('user = {:u}', {'u': uid}), sort: '-created', limit: limit)
      .map(
        (records) => [
          for (final r in records)
            InboxNotification(
              id: r.id,
              title: r.str('title'),
              body: r.str('body'),
              category: r.enumValue('category', NotificationCategory.values, NotificationCategory.system),
              severity: r.enumValue('severity', AlertSeverity.values, AlertSeverity.info),
              createdAt: r.createdAt,
              route: r.strOrNull('route'),
              readAt: r.date('readAt'),
            ),
        ],
      );

  @override
  Future<void> markRead(String uid, String notificationId) => pbGuard(
    () => _pb.collection('inbox').update(notificationId, body: {'readAt': pbDate(DateTime.now())}),
  );

  @override
  Future<void> markAllRead(String uid) => pbGuard(() async {
    final unread = await _pb.collection('inbox').getFullList(
      filter: _pb.filter('user = {:u} && readAt = ""', {'u': uid}),
      batch: 400,
    );
    final now = pbDate(DateTime.now());
    for (final r in unread) {
      await _pb.collection('inbox').update(r.id, body: {'readAt': now});
    }
  });

  /// Audience filtering (`audienceRoles` ∋ caller's role) is the alerts
  /// collection's list rule; [roleCode] is implied by the session.
  @override
  Stream<List<HotelAlert>> watchAlerts(String hotelId, {required String roleCode, bool openOnly = true}) {
    final status = openOnly ? ' && (status = "open" || status = "acknowledged")' : '';
    return _live
        .list('alerts', filter: _pb.filter('hotel = {:h}$status', {'h': hotelId}), sort: '-created', limit: 50)
        .map(
          (records) => [
            for (final r in records)
              HotelAlert(
                id: r.id,
                type: r.enumValue('type', AlertType.values, AlertType.system),
                severity: r.enumValue('severity', AlertSeverity.values, AlertSeverity.info),
                title: r.str('title'),
                message: r.str('message'),
                status: r.enumValue('status', AlertStatus.values, AlertStatus.open),
                createdAt: r.createdAt,
                route: r.strOrNull('route'),
                acknowledgedByName: r.strOrNull('acknowledgedByName'),
              ),
          ]..sort((a, b) {
            final sv = b.severity.index.compareTo(a.severity.index);
            return sv != 0 ? sv : b.createdAt.compareTo(a.createdAt);
          }),
        );
  }

  @override
  Future<void> acknowledgeAlert(String hotelId, String alertId, Actor actor) => pbGuard(
    () => _pb.collection('alerts').update(alertId, body: {'status': AlertStatus.acknowledged.name}),
  );
}

// ---------------------------------------------------------------- insights

class PocketBaseInsightsRepository implements InsightsRepository {
  PocketBaseInsightsRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  @override
  Stream<List<AiInsight>> watchInsights(String hotelId, {bool activeOnly = true}) => _live
      .list(
        'aiInsights',
        filter: _pb.filter('hotel = {:h}${activeOnly ? ' && status = "active"' : ''}', {'h': hotelId}),
        sort: '-created',
        limit: 30,
      )
      .map(
        (records) => [
          for (final r in records)
            AiInsight(
              id: r.id,
              category: r.enumValue('category', InsightCategory.values, InsightCategory.energy),
              title: r.str('title'),
              summary: r.str('summary'),
              recommendation: r.str('recommendation'),
              confidence: r.dbl('confidence', 0.5),
              status: r.enumValue('status', InsightStatus.values, InsightStatus.active),
              source: r.strOrNull('source') ?? 'rules',
              createdAt: r.createdAt,
              evidence: r.strings('evidence'),
              estimatedMonthlySaving: r.dblOrNull('estimatedMonthlySaving'),
              route: r.strOrNull('route'),
            ),
        ],
      );

  @override
  Future<void> updateStatus(String hotelId, String insightId, InsightStatus status, Actor actor) =>
      pbGuard(() => _pb.collection('aiInsights').update(insightId, body: {'status': status.name}));
}

/// `POST /api/zarin/ai/ask`: grounded in the hotel's analytics on the
/// server; answers from the configured LLM or the rule-based fallback.
class PocketBaseAiAssistantRepository implements AiAssistantRepository {
  PocketBaseAiAssistantRepository(this._pb);

  final PocketBase _pb;

  @override
  Future<AssistantReply> ask({
    required String hotelId,
    required String question,
    required List<ChatMessage> history,
    required String localeCode,
  }) => pbGuard(() async {
    final recent = history.where((m) => !m.isError).toList();
    final result = await _pb.send<Map<String, dynamic>>('/api/zarin/ai/ask', method: 'POST', body: {
      'hotelId': hotelId,
      'question': question,
      'locale': localeCode,
      'history': [
        for (final m in recent.skip(recent.length > 12 ? recent.length - 12 : 0)) {'role': m.role.name, 'text': m.text},
      ],
    });
    return AssistantReply(
      text: result['answer'] as String? ?? '',
      dataPoints: (result['dataPoints'] as List? ?? const []).whereType<String>().toList(),
    );
  });
}

// ----------------------------------------------------------------- reports

class PocketBaseReportsRepository implements ReportsRepository {
  PocketBaseReportsRepository(this._pb) : _live = PbLive(_pb);

  final PocketBase _pb;
  final PbLive _live;

  static ReportRecord fromRecord(RecordModel r) => ReportRecord(
    id: r.id,
    type: r.enumValue('type', ReportType.values, ReportType.executiveSummary),
    from: r.dateOrNow('from'),
    to: r.dateOrNow('to'),
    createdAt: r.createdAt,
    createdByName: r.str('createdByName'),
    storagePath: r.strOrNull('file'),
  );

  @override
  Stream<List<ReportRecord>> watchReports(String hotelId, {int limit = 20}) => _live
      .list('reports', filter: _pb.filter('hotel = {:h}', {'h': hotelId}), sort: '-created', limit: limit)
      .map((records) => records.map(fromRecord).toList());

  @override
  Future<ReportRecord> archive(
    String hotelId, {
    required ReportType type,
    required DateTime from,
    required DateTime to,
    required Uint8List pdfBytes,
    required Actor actor,
  }) => pbGuard(() async {
    final r = await _pb.collection('reports').create(
      body: {
        'hotel': hotelId,
        'type': type.name,
        'from': pbDate(from),
        'to': pbDate(to),
        'sizeBytes': pdfBytes.lengthInBytes,
      },
      files: [
        http.MultipartFile.fromBytes(
          'file',
          pdfBytes,
          filename: 'report_${type.name}.pdf',
          contentType: MediaType('application', 'pdf'),
        ),
      ],
    );
    return fromRecord(r);
  });
}
