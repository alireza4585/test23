import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/routing/app_router.dart';
import '../../../core/routing/routes.dart';
import '../../auth/application/auth_providers.dart';
import '../application/share_intake.dart';

/// Opens a share from another app in the review form (text, link) or the CSV
/// import, once someone is signed in. The router's guard decides whether the
/// user may open it (reviews.manage and the hotel's guestReviews flag).
class ShareGate extends ConsumerStatefulWidget {
  const ShareGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<ShareGate> createState() => _ShareGateState();
}

class _ShareGateState extends ConsumerState<ShareGate> {
  StreamSubscription<SharedPayload>? _sub;

  @override
  void initState() {
    super.initState();
    final intake = ref.read(shareIntakeProvider);
    _sub = intake.stream.listen(_received);
    unawaited(intake.start().then((p) {
      if (p != null) _received(p);
    }));
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _received(SharedPayload p) {
    if (!mounted) return;
    ref.read(pendingShareProvider.notifier).put(p);
    _open();
  }

  void _open() {
    final p = ref.read(pendingShareProvider);
    if (p == null || ref.read(currentUserProvider).value == null) return;
    ref.read(routerProvider).push(p.isCsv ? Routes.reviewsImport : Routes.reviewsAdd);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(currentUserProvider, (prev, next) {
      if (prev?.value == null && next.value != null) _open();
    });
    return widget.child;
  }
}
