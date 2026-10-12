import '../features/ai/domain/ai_models.dart';

/// JSON shapes of `aiInsights.expectedImpact` / `aiInsights.evaluation`
/// (written by the server; see pocketbase/pb_hooks/lib/recommendations.js).
double? _num(Object? v) => v is num ? v.toDouble() : null;

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;

ExpectedImpact? expectedImpactFromJson(Object? json) {
  if (json is! Map) return null;
  final baseline = _num(json['baseline']);
  final expected = _num(json['expected']);
  final method = _str(json['method']);
  if (baseline == null || expected == null || method == null) return null;
  return ExpectedImpact(
    metric: _str(json['metric']) ?? '',
    unit: _str(json['unit']) ?? '',
    baseline: baseline,
    expected: expected,
    method: method,
    monthlySaving: _num(json['monthlyIrr']),
  );
}

InsightEvaluation? evaluationFromJson(Object? json) {
  if (json is! Map) return null;
  final status = EvaluationStatus.values.where((s) => s.name == json['status']).firstOrNull;
  if (status == null) return null;
  final window = json['window'] is Map ? json['window'] as Map : const {};
  final due = _str(json['dueAt']);
  return InsightEvaluation(
    status: status,
    method: _str(json['method']) ?? '',
    unit: _str(json['unit']),
    baseline: _num(json['baseline']),
    actual: _num(json['actual']),
    delta: _num(json['delta']),
    improved: json['improved'] is bool ? json['improved'] as bool : null,
    monthlySaving: _num(json['monthlyIrr']),
    confidence: _str(json['confidence']),
    detail: _str(json['detail']),
    limitations: json['limitations'] is List ? [for (final l in json['limitations'] as List) '$l'] : const [],
    dueAt: due == null ? null : DateTime.tryParse(due)?.toLocal(),
    afterFrom: _str(window['afterFrom']),
    afterTo: _str(window['afterTo']),
  );
}
