import 'dart:typed_data';

/// Platform-neutral file payload (camera photo, gallery image, generated PDF).
/// Keeps `image_picker` / `dart:io` out of the domain and data layers.
class MediaFile {
  const MediaFile({
    required this.name,
    required this.bytes,
    required this.mimeType,
  });

  final String name;
  final Uint8List bytes;
  final String mimeType;

  int get sizeInBytes => bytes.lengthInBytes;
}
