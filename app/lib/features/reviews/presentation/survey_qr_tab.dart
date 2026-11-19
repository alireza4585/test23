import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/components.dart';
import '../../../core/widgets/feedback.dart';
import '../application/review_providers.dart';
import '../domain/review.dart';

/// A QR code drawn from the `barcode` package (re-exported by `pdf`), no image assets.
class QrCode extends StatelessWidget {
  const QrCode({super.key, required this.data, this.size = 160});

  final String data;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: CustomPaint(painter: _QrPainter(data)),
  );
}

class _QrPainter extends CustomPainter {
  _QrPainter(this.data);

  final String data;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    final black = Paint()..color = Colors.black;
    for (final e in pw.Barcode.qrCode().make(data, width: size.width, height: size.height)) {
      if (e is pw.BarcodeBar && e.black) canvas.drawRect(Rect.fromLTWH(e.left, e.top, e.width, e.height), black);
    }
  }

  @override
  bool shouldRepaint(_QrPainter old) => old.data != data;
}

/// Managers: the public QR card and one card per room. A room's code changes
/// at every check-out, so its card is listed again for printing.
class SurveyQrTab extends ConsumerWidget {
  const SurveyQrTab({super.key});

  Future<void> _run(BuildContext context, Future<void> Function() call) async {
    try {
      await call();
    } catch (e) {
      if (context.mounted) showFailure(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final profile = ref.watch(reviewProfileProvider).value;
    final actions = ref.read(reviewActionsProvider);
    return AsyncValueView<List<SurveyToken>>(
      value: ref.watch(surveyTokensProvider),
      data: (tokens) {
        final public = tokens.where((t) => t.kind == SurveyTokenKind.public).firstOrNull;
        final rooms = tokens.where((t) => t.kind == SurveyTokenKind.room).toList();
        final toPrint = rooms.where((t) => t.needsPrint).toList();
        return PageBody(
          maxWidth: 900,
          children: [
            SectionHeader(title: l10n.rvQrPublicTitle, subtitle: l10n.rvQrPublicHint),
            if (profile != null && !profile.survey.publicEnabled) Text(l10n.rvQrDisabled, style: Theme.of(context).textTheme.bodySmall),
            if (public == null)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton(
                  key: const ValueKey('rv-qr-create-public'),
                  onPressed: () => _run(context, () => actions.createSurveyTokens(SurveyTokenKind.public)),
                  child: Text(l10n.rvQrCreatePublic),
                ),
              )
            else
              ZCard(
                child: Row(
                  children: [
                    QrCode(data: public.url, size: 120),
                    const SizedBox(width: Insets.lg),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SelectableText(public.url, textDirection: TextDirection.ltr, style: Theme.of(context).textTheme.bodySmall),
                          const SizedBox(height: Insets.sm),
                          Wrap(spacing: Insets.sm, children: [
                            FilledButton.tonal(
                              onPressed: () => _run(context, () => _print(context, ref, [public], profile)),
                              child: Text(l10n.rvQrPrint),
                            ),
                            TextButton(onPressed: () => _rotate(context, ref, public), child: Text(l10n.rvQrRotate)),
                          ]),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            SectionHeader(title: l10n.rvQrRoomsTitle, subtitle: l10n.rvQrRoomsHint),
            if (profile != null && !profile.survey.roomEnabled) Text(l10n.rvQrDisabled, style: Theme.of(context).textTheme.bodySmall),
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton(
                  key: const ValueKey('rv-qr-create-rooms'),
                  onPressed: () => _run(context, () => actions.createSurveyTokens(SurveyTokenKind.room)),
                  child: Text(l10n.rvQrCreateRooms),
                ),
                if (rooms.isNotEmpty) Text(l10n.rvQrNeedPrint(toPrint.length), key: const ValueKey('rv-qr-need-print')),
                if (toPrint.isNotEmpty)
                  FilledButton(
                    onPressed: () => _run(context, () => _print(context, ref, toPrint, profile)),
                    child: Text(l10n.rvQrPrint),
                  ),
              ],
            ),
            const SizedBox(height: Insets.sm),
            for (final t in rooms)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(t.needsPrint ? Icons.print_outlined : Icons.check, color: t.needsPrint ? Theme.of(context).colorScheme.error : null),
                title: Text(l10n.rvQrRoom(context.fmt.digits(t.roomNumber ?? ''))),
                trailing: TextButton(onPressed: () => _rotate(context, ref, t), child: Text(l10n.rvQrRotate)),
              ),
            const SizedBox(height: 80),
          ],
        );
      },
    );
  }

  Future<void> _rotate(BuildContext context, WidgetRef ref, SurveyToken t) async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(l10n.rvQrRotateConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(MaterialLocalizations.of(c).cancelButtonLabel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l10n.rvConfirm)),
        ],
      ),
    );
    if (ok == true && context.mounted) await _run(context, () => ref.read(reviewActionsProvider).rotateSurveyToken(t.id));
  }

  /// A4 sheet of cards (2 × 3): the brand, "how was your stay", the QR code and, for rooms, the room number.
  Future<void> _print(BuildContext context, WidgetRef ref, List<SurveyToken> tokens, ReviewProfile? profile) async {
    final l10n = context.l10n;
    final fmt = context.fmt;
    final dir = Directionality.of(context) == TextDirection.rtl ? pw.TextDirection.rtl : pw.TextDirection.ltr;
    final brand = profile == null ? '' : (profile.survey.brandName.isNotEmpty ? profile.survey.brandName : profile.nameFa);
    final regular = pw.Font.ttf(await rootBundle.load('assets/fonts/Vazirmatn-Regular.ttf'));
    final bold = pw.Font.ttf(await rootBundle.load('assets/fonts/Vazirmatn-Bold.ttf'));
    final doc = pw.Document(theme: pw.ThemeData.withFont(base: regular, bold: bold));
    pw.Widget card(SurveyToken t) => pw.Container(
      padding: const pw.EdgeInsets.all(12),
      decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfColors.grey600, width: 0.5)),
      child: pw.Column(
        mainAxisAlignment: pw.MainAxisAlignment.center,
        children: [
          if (brand.isNotEmpty) pw.Text(brand, textDirection: dir, style: const pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 14)),
          pw.SizedBox(height: 4),
          pw.Text(l10n.rvQrCardTitle, textDirection: dir, style: const pw.TextStyle(fontSize: 12)),
          pw.SizedBox(height: 8),
          pw.BarcodeWidget(barcode: pw.Barcode.qrCode(), data: t.url, width: 120, height: 120),
          pw.SizedBox(height: 6),
          pw.Text(l10n.rvQrCardHint, textDirection: dir, style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
          if (t.roomNumber != null) pw.Text(l10n.rvQrRoom(fmt.digits(t.roomNumber!)), textDirection: dir, style: const pw.TextStyle(fontSize: 9)),
        ],
      ),
    );
    for (var i = 0; i < tokens.length; i += 6) {
      final page = tokens.skip(i).take(6).toList();
      doc.addPage(pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(24),
        build: (_) => pw.GridView(crossAxisCount: 2, childAspectRatio: 1.15, children: [for (final t in page) card(t)]),
      ));
    }
    final bytes = await doc.save();
    await Printing.sharePdf(bytes: bytes, filename: 'survey-qr-cards.pdf');
    await ref.read(reviewActionsProvider).markPrinted([for (final t in tokens) t.id]);
  }
}
