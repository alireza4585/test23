/// Backend-agnostic failure taxonomy.
///
/// Data-layer implementations (Firebase, demo, future REST) translate their
/// vendor-specific exceptions into these types so that the presentation layer
/// can show consistent, localized messages without knowing which backend is
/// active.
sealed class AppFailure implements Exception {
  const AppFailure([this.debugMessage]);

  /// Developer-facing details. Never shown to end users.
  final String? debugMessage;

  @override
  String toString() => '$runtimeType(${debugMessage ?? ''})';
}

/// National ID / password combination rejected.
final class InvalidCredentialsFailure extends AppFailure {
  const InvalidCredentialsFailure([super.debugMessage]);
}

/// Account exists but was suspended by an administrator.
final class AccountDisabledFailure extends AppFailure {
  const AccountDisabledFailure([super.debugMessage]);
}

/// Authenticated, but the account has no role / hotel assigned yet.
final class AccountNotProvisionedFailure extends AppFailure {
  const AccountNotProvisionedFailure([super.debugMessage]);
}

/// Too many attempts — backend rate limiting kicked in.
final class TooManyRequestsFailure extends AppFailure {
  const TooManyRequestsFailure([super.debugMessage]);
}

/// The signed-in user is not allowed to perform the action. Raised both by
/// client-side policy checks and when the backend rejects a request
/// (e.g. Firestore `permission-denied`).
final class PermissionDeniedFailure extends AppFailure {
  const PermissionDeniedFailure([super.debugMessage]);
}

final class NotFoundFailure extends AppFailure {
  const NotFoundFailure([super.debugMessage]);
}

/// Input rejected by a domain rule (e.g. invalid room status transition).
final class ValidationFailure extends AppFailure {
  const ValidationFailure(this.code, [super.debugMessage]);

  /// Stable machine-readable code, mapped to a localized message in the UI.
  final String code;
}

final class NetworkFailure extends AppFailure {
  const NetworkFailure([super.debugMessage]);
}

final class SessionExpiredFailure extends AppFailure {
  const SessionExpiredFailure([super.debugMessage]);
}

/// Feature is available only on a backend that supports it (e.g. AI assistant
/// requires Cloud Functions).
final class UnsupportedFailure extends AppFailure {
  const UnsupportedFailure([super.debugMessage]);
}

final class UnexpectedFailure extends AppFailure {
  const UnexpectedFailure([super.debugMessage]);
}
