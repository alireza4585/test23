import 'dart:async';
import 'dart:io' show Platform;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:uuid/uuid.dart';

import '../../features/auth/domain/user_session.dart';
import '../domain/media_file.dart';

/// Key/value storage for small secrets (device id, remembered national ID).
/// Backed by iOS Keychain / Android Keystore-encrypted storage.
abstract interface class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterSecureStore implements SecureStore {
  FlutterSecureStore()
    : _storage = const FlutterSecureStorage(
        iOptions: IOSOptions(
          accessibility: KeychainAccessibility.first_unlock_this_device,
        ),
      );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class InMemorySecureStore implements SecureStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// Push messaging abstraction. Firebase Cloud Messaging in the MVP; an
/// Iranian push provider (where Google Play Services are unavailable) or
/// APNs-direct can be added without touching feature code.
abstract interface class PushService {
  Future<void> requestPermission();
  Future<String?> token();
  Stream<String> get tokenRefresh;

  /// Route (deep link) of a notification the user tapped.
  Stream<String> get openedRoutes;
}

class NoopPushService implements PushService {
  const NoopPushService();

  @override
  Future<void> requestPermission() async {}

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get tokenRefresh => const Stream.empty();

  @override
  Stream<String> get openedRoutes => const Stream.empty();
}

/// Collects a [DeviceDescriptor] for session registration.
class DeviceInfoService {
  DeviceInfoService(this._secureStore, this._push);

  static const _deviceIdKey = 'zh.deviceId';

  final SecureStore _secureStore;
  final PushService _push;

  Future<String> deviceId() async {
    final existing = await _secureStore.read(_deviceIdKey);
    if (existing != null) return existing;
    final id = const Uuid().v4();
    await _secureStore.write(_deviceIdKey, id);
    return id;
  }

  Future<DeviceDescriptor> describe() async {
    final id = await deviceId();
    var platform = 'other';
    var model = 'unknown';
    var os = '';
    var version = '0.0.0';
    try {
      final info = DeviceInfoPlugin();
      if (!kIsWeb && Platform.isAndroid) {
        final a = await info.androidInfo;
        platform = 'android';
        model = '${a.manufacturer} ${a.model}';
        os = 'Android ${a.version.release}';
      } else if (!kIsWeb && Platform.isIOS) {
        final i = await info.iosInfo;
        platform = 'ios';
        model = i.utsname.machine;
        os = '${i.systemName} ${i.systemVersion}';
      }
      version = (await PackageInfo.fromPlatform()).version;
    } catch (_) {
      // Device details are best-effort (tests, unsupported platforms).
    }
    return DeviceDescriptor(
      deviceId: id,
      platform: platform,
      model: model,
      osVersion: os,
      appVersion: version,
      pushToken: await _push.token(),
    );
  }
}

/// Camera / gallery picking, returning platform-neutral [MediaFile]s.
abstract interface class MediaPicker {
  Future<MediaFile?> pickImage({required bool fromCamera});
}

class ImagePickerMediaPicker implements MediaPicker {
  ImagePickerMediaPicker() : _picker = ImagePicker();

  final ImagePicker _picker;

  @override
  Future<MediaFile?> pickImage({required bool fromCamera}) async {
    final file = await _picker.pickImage(
      source: fromCamera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 78,
    );
    if (file == null) return null;
    return MediaFile(
      name: file.name,
      bytes: await file.readAsBytes(),
      mimeType: file.mimeType ?? 'image/jpeg',
    );
  }
}
