import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../../core/di/core_providers.dart';
import '../../../core/error/app_failure.dart';
import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/utils/day_key.dart';
import '../../../data/repository_providers.dart';
import '../../ai/domain/ai_models.dart';
import '../../auth/application/auth_providers.dart';
import '../../auth/domain/app_user.dart';
import '../../energy/domain/energy_analytics.dart';
import '../../energy/domain/energy_reading.dart';
import '../../hotel/domain/hotel.dart';
import '../../housekeeping/domain/housekeeping_task.dart';
import '../../inventory/domain/inventory_item.dart';
import '../../maintenance/domain/maintenance_ticket.dart';
import '../../operations/domain/daily_operations.dart';
import '../domain/report_models.dart';

final reportsListProvider = StreamProvider<List<ReportRecord>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.hasHotel || !user.can(AppPermission.reportsView)) {
    return Stream.value(const []);
  }
  return ref.watch(reportsRepositoryProvider).watchReports(user.hotelId);
});

class GeneratedReport {
  const GeneratedReport({required this.bytes, required this.fileName});

  final Uint8List bytes;
  final String fileName;
}

/// Builds management PDF reports on-device (works offline and in demo mode)
/// and archives them through [ReportsRepository]. Scheduled server-side
/// reports (n8n → `GET /v1/hotels/:id/summary`) reuse the same KPIs.
class ReportGenerator {
  ReportGenerator(this.ref);

  final Ref ref;

  Future<GeneratedReport> generate({
    required ReportType type,
    required int days,
    required AppLocalizations l10n,
    required Formatters fmt,
  }) async {
    final user = ref.read(sessionUserProvider);
    if (user == null) throw const SessionExpiredFailure();
    if (!user.can(AppPermission.reportsGenerate)) {
      throw const PermissionDeniedFailure();
    }
    final now = ref.read(clockProvider).now();
    final to = DayKey.startOfDay(now).subtract(const Duration(days: 1));
    final from = to.subtract(Duration(days: days - 1));

    final data = await _load(user, from: from, to: to, days: days);
    final hotel = data.hotel;
    final settings = hotel?.settings ?? const HotelSettings();
    final regular = pw.Font.ttf(await rootBundle.load('assets/fonts/Vazirmatn-Regular.ttf'));
    final bold = pw.Font.ttf(await rootBundle.load('assets/fonts/Vazirmatn-Bold.ttf'));
    final rtl = fmt.isFa;

    final doc = pw.Document(
      theme: pw.ThemeData.withFont(base: regular, bold: bold),
      title: l10n.reportType(type),
      author: l10n.appName,
    );

    final sections = <pw.Widget>[];

    pw.Widget heading(String text) => pw.Padding(
      padding: const pw.EdgeInsets.only(top: 14, bottom: 6),
      child: pw.Text(text, style: const pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
    );

    pw.Widget table(List<String> header, List<List<String>> rows) => pw.TableHelper.fromTextArray(
      headers: header,
      data: rows,
      headerStyle: const pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 9),
      cellStyle: const pw.TextStyle(fontSize: 9),
      headerDecoration: const pw.BoxDecoration(color: PdfColor.fromInt(0xFFEDEBE5)),
      cellAlignment: rtl ? pw.Alignment.centerRight : pw.Alignment.centerLeft,
      headerAlignment: rtl ? pw.Alignment.centerRight : pw.Alignment.centerLeft,
      border: const pw.TableBorder(
        horizontalInside: pw.BorderSide(color: PdfColor.fromInt(0xFFDCD9D1), width: 0.5),
      ),
    );

    final operations = data.operations
        .where((o) => !o.day.isBefore(from) && !o.day.isAfter(to))
        .toList();
    final energy = data.energy;
    final summaries = {
      for (final t in EnergyType.values)
        t: EnergyAnalytics.summarize(
          type: t,
          readings: energy,
          from: from,
          to: to,
          baseline: settings.energyDailyBaseline[t.name] ?? 0,
          alertThresholdPct: settings.energyAlertThresholdPct,
          tariff: settings.energyTariff[t.name],
          operations: operations,
        ),
    };

    if (type == ReportType.executiveSummary) {
      final avgOcc = operations.isEmpty
          ? 0.0
          : operations.fold<double>(0, (s, o) => s + o.occupancyRate) / operations.length;
      final roomRevenue = operations.fold<double>(0, (s, o) => s + o.roomRevenue);
      final totalRevenue = operations.fold<double>(0, (s, o) => s + o.totalRevenue);
      final sold = operations.fold<int>(0, (s, o) => s + o.roomsOccupied);
      final available = operations.fold<int>(0, (s, o) => s + o.roomsAvailable);
      final tickets = data.tickets.where((t) => t.status.isActive).toList();
      final lowStock = data.inventory.where((i) => i.isLowStock).length;
      final insights = data.insights;
      final elec = summaries[EnergyType.electricity]!;
      sections
        ..add(heading(l10n.sectionToday))
        ..add(table(
          [l10n.reportPeriod, fmt.dateShort(from), fmt.dateShort(to)],
          [
            [l10n.kpiOccupancy, fmt.percent(avgOcc, decimals: 1), ''],
            [l10n.kpiAdr, fmt.money(sold == 0 ? 0 : roomRevenue / sold), l10n.currencyRial],
            [l10n.kpiRevpar, fmt.money(available == 0 ? 0 : roomRevenue / available), l10n.currencyRial],
            [l10n.kpiRevenue, fmt.money(totalRevenue), l10n.currencyRial],
            [l10n.energyElectricity, fmt.number(elec.total), 'kWh'],
            [l10n.vsBaselineShort(''), fmt.percent(elec.vsBaselinePct ?? 0, signed: true), ''],
            [l10n.kpiEnergyIntensity, fmt.number(elec.perOccupiedRoom ?? 0, decimals: 1), l10n.kpiEnergyIntensityUnit],
            [l10n.kpiOpenTickets, fmt.number(tickets.length), l10n.kpiOverdueTickets(fmt.number(tickets.where((t) => t.isOverdue(now)).length))],
            [l10n.kpiLowStock, fmt.number(lowStock), ''],
          ],
        ));
      if (insights.isNotEmpty) {
        sections.add(heading(l10n.sectionInsights));
        for (final i in insights.take(5)) {
          sections.add(pw.Bullet(text: '${i.title} — ${i.recommendation}', style: const pw.TextStyle(fontSize: 10)));
        }
      }
    }

    if (type == ReportType.energy || type == ReportType.executiveSummary) {
      sections
        ..add(heading(l10n.reportEnergy))
        ..add(table(
          ['', l10n.totalConsumption, l10n.dailyAverage, l10n.baseline, l10n.vsBaselineShort(''), l10n.estimatedCost],
          [
            for (final s in summaries.values)
              [
                '${l10n.energyType(s.type)} (${s.type.unit})',
                fmt.number(s.total),
                fmt.number(s.dailyAverage),
                fmt.number(s.baseline),
                fmt.percent(s.vsBaselinePct ?? 0, signed: true),
                fmt.money(s.estimatedCost ?? 0),
              ],
          ],
        ));
      if (type == ReportType.energy) {
        final elec = summaries[EnergyType.electricity]!;
        final water = summaries[EnergyType.water]!;
        final gas = summaries[EnergyType.gas]!;
        sections
          ..add(heading(l10n.dateLabel))
          ..add(table(
            [l10n.dateLabel, l10n.energyElectricity, l10n.energyWater, l10n.energyGas],
            [
              for (var i = 0; i < elec.series.length; i++)
                [
                  fmt.date(elec.series[i].day),
                  fmt.number(elec.series[i].value),
                  fmt.number(water.series[i].value, decimals: 1),
                  fmt.number(gas.series[i].value),
                ],
            ],
          ));
      }
    }

    if (type == ReportType.maintenance) {
      final tickets = data.tickets;
      final byStatus = {
        for (final s in TicketStatus.values) s: tickets.where((t) => t.status == s).length,
      };
      sections
        ..add(heading(l10n.mntTitle))
        ..add(table(
          [for (final s in TicketStatus.values) l10n.ticketStatus(s)],
          [
            [for (final s in TicketStatus.values) fmt.number(byStatus[s]!)],
          ],
        ))
        ..add(heading(l10n.sectionRequests))
        ..add(table(
          [l10n.ticketTitleLabel, l10n.ticketLocationLabel, l10n.priorityLabel, l10n.ticketCategoryLabel, l10n.dateLabel],
          [
            for (final t in tickets)
              [
                t.title,
                t.locationLabel,
                l10n.ticketPriority(t.priority),
                l10n.ticketStatus(t.status),
                fmt.dateTime(t.createdAt),
              ],
          ],
        ));
    }

    if (type == ReportType.housekeeping) {
      final tasks = data.tasks;
      sections
        ..add(heading(l10n.hkTitle))
        ..add(table(
          [l10n.roomLabel(''), l10n.taskTypeLabel, l10n.assignee, l10n.priorityLabel, l10n.taskStatusDone],
          [
            for (final t in tasks)
              [
                fmt.digits(t.roomNumber),
                l10n.taskType(t.type),
                t.assigneeName ?? l10n.unassigned,
                l10n.taskPriority(t.priority),
                t.duration == null
                    ? l10n.taskStatus(t.status)
                    : l10n.minutesValue(fmt.number(t.duration!.inMinutes)),
              ],
          ],
        ));
    }

    if (type == ReportType.inventory) {
      final items = data.inventory;
      sections
        ..add(heading(l10n.invTitle))
        ..add(table(
          [l10n.itemName, l10n.onHand, l10n.reorderLevel, l10n.stockValue, ''],
          [
            for (final i in items)
              [
                i.name,
                '${fmt.number(i.quantity)} ${i.unit}',
                fmt.number(i.reorderLevel),
                fmt.money(i.stockValue ?? 0),
                i.isLowStock ? l10n.lowStock : '',
              ],
          ],
        ));
    }

    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        textDirection: rtl ? pw.TextDirection.rtl : pw.TextDirection.ltr,
        margin: const pw.EdgeInsets.all(32),
        header: (context) => pw.Container(
          padding: const pw.EdgeInsets.only(bottom: 8),
          decoration: const pw.BoxDecoration(
            border: pw.Border(bottom: pw.BorderSide(color: PdfColor.fromInt(0xFFC8A25A), width: 1)),
          ),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    '${l10n.appName} — ${l10n.reportType(type)}',
                    style: const pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold),
                  ),
                  pw.Text(
                    '${hotel?.name ?? ''} · ${fmt.date(from)} – ${fmt.date(to)}',
                    style: const pw.TextStyle(fontSize: 10, color: PdfColor.fromInt(0xFF5A5F68)),
                  ),
                ],
              ),
              pw.Text(
                fmt.digits('${context.pageNumber}/${context.pagesCount}'),
                style: const pw.TextStyle(fontSize: 9),
              ),
            ],
          ),
        ),
        footer: (context) => pw.Text(
          l10n.reportBy(fmt.dateTime(now), user.fullName),
          style: const pw.TextStyle(fontSize: 8, color: PdfColor.fromInt(0xFF8C919A)),
        ),
        build: (_) => sections,
      ),
    );

    final bytes = await doc.save();
    await ref.read(reportsRepositoryProvider).archive(
      user.hotelId,
      type: type,
      from: from,
      to: to,
      pdfBytes: bytes,
      actor: user.asActor,
    );
    return GeneratedReport(
      bytes: bytes,
      fileName: 'zarin-${type.name}-${DayKey.of(from)}_${DayKey.of(to)}.pdf',
    );
  }
  /// One-shot, permission-aware reads straight from the repositories (each
  /// section only includes data the user's role may see — the backend would
  /// reject anything else anyway).
  Future<_ReportData> _load(
    AppUser user, {
    required DateTime from,
    required DateTime to,
    required int days,
  }) async {
    final h = user.hotelId;
    final hotel = await ref.read(hotelRepositoryProvider).watchHotel(h).first;

    final canOps = user.canAny(const {
      AppPermission.financeView,
      AppPermission.operationsRecordDaily,
      AppPermission.energyView,
      AppPermission.dashboardOperations,
    });
    final operations = canOps
        ? await ref.read(operationsRepositoryProvider).watchRange(h, from: from, to: to).first
        : const <DailyOperations>[];

    final energy = user.can(AppPermission.energyView)
        ? await ref
              .read(energyRepositoryProvider)
              .watchReadings(h, from: from.subtract(Duration(days: days)), to: to)
              .first
        : const <EnergyReading>[];

    final canSeeTickets = user.canAny(const {
      AppPermission.maintenanceViewAll,
      AppPermission.maintenanceViewOwn,
    });
    final tickets = canSeeTickets
        ? await ref
              .read(maintenanceRepositoryProvider)
              .watchTickets(
                h,
                scope: user.can(AppPermission.maintenanceViewAll) ? const AllTickets() : MyTickets(user.uid),
              )
              .first
        : const <MaintenanceTicket>[];

    final inventory = user.can(AppPermission.inventoryView)
        ? await ref.read(inventoryRepositoryProvider).watchItems(h).first
        : const <InventoryItem>[];

    final insights = user.can(AppPermission.aiInsightsView)
        ? await ref.read(insightsRepositoryProvider).watchInsights(h).first
        : const <AiInsight>[];

    final canSeeTasks = user.canAny(const {
      AppPermission.housekeepingViewAll,
      AppPermission.housekeepingViewOwn,
    });
    final tasks = canSeeTasks
        ? await ref
              .read(housekeepingRepositoryProvider)
              .watchTasks(
                h,
                day: ref.read(clockProvider).now(),
                assigneeId: user.can(AppPermission.housekeepingViewAll) ? null : user.uid,
              )
              .first
        : const <HousekeepingTask>[];

    return _ReportData(
      hotel: hotel,
      operations: operations,
      energy: energy,
      tickets: tickets,
      inventory: inventory,
      insights: insights,
      tasks: tasks,
    );
  }
}

class _ReportData {
  const _ReportData({
    required this.hotel,
    required this.operations,
    required this.energy,
    required this.tickets,
    required this.inventory,
    required this.insights,
    required this.tasks,
  });

  final Hotel? hotel;
  final List<DailyOperations> operations;
  final List<EnergyReading> energy;
  final List<MaintenanceTicket> tickets;
  final List<InventoryItem> inventory;
  final List<AiInsight> insights;
  final List<HousekeepingTask> tasks;
}

final reportGeneratorProvider = Provider<ReportGenerator>(ReportGenerator.new);
