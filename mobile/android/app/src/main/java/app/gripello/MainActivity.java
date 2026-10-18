package app.gripello;

import android.app.DownloadManager;
import android.content.Intent;
import android.util.Base64;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceError;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    private static final String APP_SCHEME = "app.gripello";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // App-local plugins register before the bridge starts in super.onCreate.
        registerPlugin(GripelloWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = bridge.getWebView();
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Passkeys: the WebView only offers WebAuthn when the app opts in; assetlinks.json vouches for the origin.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                webView.getSettings(),
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            );
        }
        // The WebView drops file downloads (grade scale PDF, backups) unless someone takes them.
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
            download(url, userAgent, contentDisposition, mimeType)
        );
        // Without a network the WebView shows its raw error page (the service worker can only help once installed),
        // so the app shows the site's own offline page, copied into the APK by the capacitor:copy:before script.
        // HTTP errors (our 404 and outage pages) stay with the site.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && unreachable(error.getErrorCode())) showOffline(view, request.getUrl().toString());
            }
        });
        // The bridge always starts at server.url; a cold start from an App Link opens the linked page instead.
        Uri link = appLink(getIntent());
        if (savedInstanceState == null && link != null) webView.loadUrl(link.toString());
    }

    private boolean sameOrigin(Uri url) {
        Uri app = Uri.parse(bridge.getAppUrl());
        return app.getScheme().equals(url.getScheme()) && app.getEncodedAuthority().equals(url.getEncodedAuthority());
    }

    // Aborted navigations (a download, a redirect to another app) also land in onReceivedError; only a missing network shows the offline page.
    private static boolean unreachable(int errorCode) {
        return (
            errorCode == WebViewClient.ERROR_HOST_LOOKUP ||
            errorCode == WebViewClient.ERROR_CONNECT ||
            errorCode == WebViewClient.ERROR_TIMEOUT
        );
    }

    private Uri appLink(Intent intent) {
        Uri link = intent.getData();
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || link == null) return null;
        // A sign-in that returns while Android had killed the app arrives as app.gripello:/auth/login?oauth2=… on a cold start.
        if (APP_SCHEME.equals(link.getScheme())) {
            return Uri.parse(bridge.getAppUrl()).buildUpon()
                .encodedPath(link.getEncodedPath())
                .encodedQuery(link.getEncodedQuery())
                .build();
        }
        return sameOrigin(link) ? link : null;
    }

    private void showOffline(WebView view, String url) {
        try {
            String icon = "data:image/png;base64," + Base64.encodeToString(asset("public/icon-192.png"), Base64.NO_WRAP);
            String html = new String(asset("public/offline.html"), StandardCharsets.UTF_8).replace("/icon-192.png", icon);
            // The failed URL stays the page's address, so the page's own health check and reload reach the server again.
            view.loadDataWithBaseURL(url, html, "text/html", "utf-8", null);
        } catch (IOException ignored) {
            // No offline page in this build (assets not synced): keep the WebView's own error page.
        }
    }

    private byte[] asset(String path) throws IOException {
        try (InputStream in = getAssets().open(path); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            for (int read; (read = in.read(buffer)) != -1; ) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        Uri uri = Uri.parse(url);
        if (!sameOrigin(uri)) return;
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(uri)
            .setMimeType(mimeType)
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .addRequestHeader("User-Agent", userAgent);
        // The public Downloads folder needs a runtime storage permission below Android 10; the app's own folder needs none
        // and the finished-download notification still opens the file.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        } else {
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
        }
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) request.addRequestHeader("Cookie", cookies);
        getSystemService(DownloadManager.class).enqueue(request);
        Toast.makeText(this, name, Toast.LENGTH_SHORT).show();
    }
}
