package com.zarinhooshmand.zarin_hooshmand

import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * F10 share target: text (a review and its link) or a CSV file shared from
 * another app reaches Dart over the "zarin/share" channel as {text, mime}.
 * "initial" returns the share that started the app (once); later shares are
 * pushed as "shared". Files over 2 MB are ignored; nothing is stored here.
 */
class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null
    private var initial: Map<String, String>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        initial = read(intent)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "zarin/share").also {
            it.setMethodCallHandler { call, result ->
                if (call.method == "initial") {
                    result.success(initial)
                    initial = null
                } else {
                    result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        read(intent)?.let { channel?.invokeMethod("shared", it) }
    }

    private fun read(intent: Intent?): Map<String, String>? {
        if (intent?.action != Intent.ACTION_SEND) return null
        val mime = intent.type ?: return null
        intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let {
            return mapOf("text" to it.take(MAX_CHARS), "mime" to mime)
        }
        @Suppress("DEPRECATION")
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return null
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                val bytes = input.readNBytesCompat(MAX_BYTES + 1)
                if (bytes.size > MAX_BYTES) null else mapOf("text" to String(bytes, Charsets.UTF_8), "mime" to mime)
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (total < limit) {
            val n = read(buffer, 0, minOf(buffer.size, limit - total))
            if (n < 0) break
            out.write(buffer, 0, n)
            total += n
        }
        return out.toByteArray()
    }

    companion object {
        private const val MAX_BYTES = 2 * 1024 * 1024
        private const val MAX_CHARS = 100_000
    }
}
