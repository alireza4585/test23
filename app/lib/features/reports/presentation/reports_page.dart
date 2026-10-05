import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../../core/l10n/enum_labels.dart';
import '../../../core/l10n/l10n.dart';
import '../../../core/security/app_permission.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/auth_providers.dart';
import '../application/report_generator.dart';
import '../domain/report_models.dart';

class ReportsPage extends ConsumerStatefulWidget {
  const ReportsPage({super.key});

  @override
  ConsumerState<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends ConsumerState<ReportsPage> {
  ReportType _type = ReportType.executiveSummary;
  int _days = 7;
  bool _busy = false;

  Future<void> _generate() async {
    setState(() => _busy = true);
    final l10n = context.l10n;
    final fmt = context.fmt;
    try {
      final report = await ref.read(reportGeneratorProvider).generate(
        type: _type,
        days: _days,
        l10n: l10n,
        fmt: fmt,
      );
      if (!mounted) return;
      showSuccess(context, l10n.reportReady);
      await Printing.sharePdf(bytes: report.bytes, filename: report.fileName);
    } catch (e) {
      if (mounted) showFailure(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final user = ref.watch(sessionUserProvider)!;
    final reports = ref.watch(reportsListProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.reportsTitle), actions: const [ShellActions()]),
      body: PageBody(
        maxWidth: 720,
        children: [
          if (user.can(AppPermission.reportsGenerate))
            ZCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  RadioGroup<ReportType>(
                    groupValue: _type,
                    onChanged: (v) => setState(() => _type = v ?? _type),
                    child: Column(
                      children: [
                        for (final t in ReportType.values)
                          RadioListTile<ReportType>(
                            contentPadding: EdgeInsets.zero,
                            value: t,
                            title: Text(l10n.reportType(t)),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: Insets.sm),
                  Text(l10n.reportPeriod, style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: Insets.sm),
                  SegmentedButton<int>(
                    segments: [
                      ButtonSegment(value: 7, label: Text(l10n.last7Days)),
                      ButtonSegment(value: 30, label: Text(l10n.last30Days)),
                    ],
                    selected: {_days},
                    onSelectionChanged: (s) => setState(() => _days = s.first),
                  ),
                  const SizedBox(height: Insets.lg),
                  FilledButton.icon(
                    key: const Key('reports.generate'),
                    onPressed: _busy ? null : _generate,
                    icon: _busy
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.picture_as_pdf_outlined),
                    label: Text(_busy ? l10n.generating : l10n.generatePdf),
                  ),
                ],
              ),
            ),
          SectionHeader(title: l10n.recentReports),
          AsyncValueView<List<ReportRecord>>(
            value: reports,
            data: (list) {
              if (list.isEmpty) return EmptyState(icon: Icons.description_outlined, message: l10n.noReports);
              return ZCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    for (final r in list)
                      ListTile(
                        leading: const Icon(Icons.picture_as_pdf_outlined),
                        title: Text(l10n.reportType(r.type)),
                        subtitle: Text(
                          '${fmt.dateShort(r.from)} – ${fmt.dateShort(r.to)} · ${l10n.reportBy(fmt.dateTime(r.createdAt), r.createdByName)}',
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
