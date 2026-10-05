import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../l10n/enum_labels.dart';
import '../l10n/l10n.dart';
import '../theme/app_theme.dart';

void showSuccess(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

void showFailure(BuildContext context, Object error) {
  final scheme = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        backgroundColor: scheme.errorContainer,
        content: Text(
          context.l10n.failure(error),
          style: TextStyle(color: scheme.onErrorContainer),
        ),
      ),
    );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(Insets.xl),
      child: SizedBox(
        width: 28,
        height: 28,
        child: CircularProgressIndicator(strokeWidth: 2.4),
      ),
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  final String message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Insets.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: scheme.onSurfaceVariant),
            const SizedBox(height: Insets.md),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
            if (action != null) ...[
              const SizedBox(height: Insets.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => EmptyState(
    icon: Icons.cloud_off_outlined,
    message: context.l10n.failure(error),
    action: onRetry == null
        ? null
        : OutlinedButton(onPressed: onRetry, child: Text(context.l10n.retry)),
  );
}

/// Renders an [AsyncValue] with consistent loading / error states.
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({
    super.key,
    required this.value,
    required this.data,
    this.onRetry,
    this.loading,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    // Keep showing previous data while refreshing.
    if (value.hasValue) return data(value.requireValue);
    if (value.hasError) {
      return ErrorView(error: value.error!, onRetry: onRetry);
    }
    return loading ?? const LoadingView();
  }
}
