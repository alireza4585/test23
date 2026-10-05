import 'dart:typed_data';

import '../../../core/domain/actor.dart';

enum ReportType { executiveSummary, energy, maintenance, housekeeping, inventory }

class ReportRecord {
  const ReportRecord({
    required this.id,
    required this.type,
    required this.from,
    required this.to,
    required this.createdAt,
    required this.createdByName,
    this.storagePath,
  });

  final String id;
  final ReportType type;
  final DateTime from;
  final DateTime to;
  final DateTime createdAt;
  final String createdByName;

  /// Location of the archived PDF (Firebase Storage path today).
  final String? storagePath;
}

abstract interface class ReportsRepository {
  Stream<List<ReportRecord>> watchReports(String hotelId, {int limit = 20});

  /// Archives a generated PDF and its metadata.
  Future<ReportRecord> archive(
    String hotelId, {
    required ReportType type,
    required DateTime from,
    required DateTime to,
    required Uint8List pdfBytes,
    required Actor actor,
  });
}
