import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_theme.dart';

export '../theme/app_colors.dart' show StatusPalette, StatusPaletteX;

/// Bordered surface used for every content block.
class ZCard extends StatelessWidget {
  const ZCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Insets.lg),
    this.onTap,
    this.highlight,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  /// Optional leading accent stripe (severity, status).
  final Color? highlight;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget content = Padding(padding: padding, child: child);
    if (highlight != null) {
      content = IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 3,
              margin: const EdgeInsetsDirectional.only(start: Insets.sm, top: Insets.md, bottom: Insets.md),
              decoration: BoxDecoration(
                color: highlight,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Expanded(child: content),
          ],
        ),
      );
    }
    return Material(
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.md),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.action, this.subtitle});

  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: Insets.xl, bottom: Insets.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleMedium),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}

/// Compact coloured label for statuses and priorities.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color, this.icon});

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Insets.sm, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Headline metric tile. One per KPI; [emphasis] paints the value gold — use
/// it for at most one tile per screen.
class KpiCard extends StatelessWidget {
  const KpiCard({
    super.key,
    required this.label,
    required this.value,
    this.unit,
    this.caption,
    this.captionColor,
    this.icon,
    this.emphasis = false,
    this.onTap,
  });

  final String label;
  final String value;
  final String? unit;
  final String? caption;
  final Color? captionColor;
  final IconData? icon;
  final bool emphasis;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ZCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: scheme.onSurfaceVariant),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.sm),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  value,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: emphasis ? scheme.primary : scheme.onSurface,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (unit != null) ...[
                  const SizedBox(width: 4),
                  Text(
                    unit!,
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (caption != null) ...[
            const SizedBox(height: 4),
            Text(
              caption!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(
                color: captionColor ?? scheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Lays out tiles in as many columns as fit [minTileWidth].
class ResponsiveGrid extends StatelessWidget {
  const ResponsiveGrid({
    super.key,
    required this.children,
    this.minTileWidth = 160,
    this.spacing = Insets.md,
    this.maxColumns = 6,
  });

  final List<Widget> children;
  final double minTileWidth;
  final double spacing;
  final int maxColumns;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = (constraints.maxWidth / (minTileWidth + spacing))
            .floor()
            .clamp(1, maxColumns);
        final width =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: [
            for (final child in children) SizedBox(width: width, child: child),
          ],
        );
      },
    );
  }
}

/// Constrains page content on tablets / desktop so dashboards stay readable.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children, this.maxWidth = 1280, this.padding});

  final List<Widget> children;
  final double maxWidth;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: AlignmentDirectional.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: ListView(
          padding: padding ??
              const EdgeInsets.fromLTRB(Insets.page, Insets.sm, Insets.page, Insets.xxl),
          children: children,
        ),
      ),
    );
  }
}

/// The Zarin monogram: a gold-outlined diamond with "Z".
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Transform.rotate(
        angle: 0.785398,
        child: Container(
          margin: EdgeInsets.all(size * 0.15),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.gold, width: size * 0.045),
            borderRadius: BorderRadius.circular(size * 0.08),
          ),
          child: Transform.rotate(
            angle: -0.785398,
            child: Center(
              child: Text(
                'Z',
                style: TextStyle(
                  fontFamily: AppTheme.fontFamily,
                  fontWeight: FontWeight.w700,
                  fontSize: size * 0.34,
                  color: AppColors.gold,
                  height: 1,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class LabeledValue extends StatelessWidget {
  const LabeledValue({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Text(value, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
