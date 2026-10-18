import Capacitor
import UIKit
import WebKit

// The iOS counterpart of MainActivity.java: the offline page and file downloads around Capacitor's web view.
class MainViewController: CAPBridgeViewController {

    private var navigation: NavigationHandler?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GripelloWidgetPlugin())
        // loadView is final and keeps Capacitor's own navigation delegate, so ours wraps it.
        guard let webView, let capacitor = webView.navigationDelegate else { return }
        navigation = NavigationHandler(capacitor: capacitor, controller: self)
        webView.navigationDelegate = navigation
    }

    // iPadOS window controls sit outside env(safe-area-inset-top); main.css adds them as --app-window-controls.
    private var windowControls: CGFloat = 0

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard #available(iOS 26.0, *) else { return }
        let controls = max(0, view.edgeInsets(for: .safeArea(cornerAdaptation: .vertical)).top - view.safeAreaInsets.top).rounded()
        guard controls != windowControls else { return }
        windowControls = controls
        applyWindowControls()
    }

    // A style element, because the site's head manager owns <html style>. Every new page needs it again.
    fileprivate func applyWindowControls() {
        webView?.evaluateJavaScript("""
            (document.getElementById('app-window-controls') ?? document.head?.appendChild(
                Object.assign(document.createElement('style'), { id: 'app-window-controls' })
            ))?.replaceChildren(':root { --app-window-controls: \(Int(windowControls))px }')
            """)
    }

    fileprivate func sameOrigin(_ url: URL?) -> Bool {
        guard let url, let app = bridge?.config.serverURL else { return false }
        return url.scheme == app.scheme && url.host == app.host && url.port == app.port
    }

    // No network means a blank page, so show the bundled offline page (capacitor:copy:before); HTTP errors stay with the site.
    fileprivate func showOffline(_ webView: WKWebView, url: URL) {
        guard
            let page = asset("public/offline.html").flatMap({ String(data: $0, encoding: .utf8) }),
            let icon = asset("public/icon-192.png")
        else { return } // No offline page in this build (assets not synced): keep the blank page.
        let html = page.replacingOccurrences(of: "/icon-192.png", with: "data:image/png;base64," + icon.base64EncodedString())
        // The failed URL stays the page's address, so the page's own health check and reload reach the server again.
        webView.loadHTMLString(html, baseURL: url)
    }

    private func asset(_ path: String) -> Data? {
        Bundle.main.resourceURL.flatMap { try? Data(contentsOf: $0.appendingPathComponent(path)) }
    }

    // Downloads land in the app's temporary folder; the share sheet saves them to Files or hands them to another app.
    fileprivate func share(_ file: URL) {
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        sheet.popoverPresentationController?.permittedArrowDirections = []
        present(sheet, animated: true)
    }
}

private class NavigationHandler: NSObject, WKNavigationDelegate, WKDownloadDelegate {

    private let capacitor: WKNavigationDelegate
    private weak var controller: MainViewController?
    private var files: [WKDownload: URL] = [:]

    init(capacitor: WKNavigationDelegate, controller: MainViewController) {
        self.capacitor = capacitor
        self.controller = controller
    }

    // Everything this class leaves alone goes to Capacitor's delegate.
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || capacitor.responds(to: selector)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        capacitor.responds(to: selector) ? capacitor : super.forwardingTarget(for: selector)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload, controller?.sameOrigin(action.request.url) == true { return decisionHandler(.download) }
        capacitor.webView?(webView, decidePolicyFor: action, decisionHandler: decisionHandler) ?? decisionHandler(.allow)
    }

    // The web view drops file downloads (data export, backups) unless someone takes them.
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let download = disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType
        decisionHandler(download && controller?.sameOrigin(response.response.url) == true ? .download : .allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        capacitor.webView?(webView, didFinish: navigation)
        controller?.applyWindowControls()
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // Aborted navigations (a download, a link to another app) also fail; only a missing network shows the offline page.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        capacitor.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        let error = error as NSError
        guard
            error.domain == NSURLErrorDomain,
            [NSURLErrorNotConnectedToInternet, NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed,
             NSURLErrorCannotConnectToHost, NSURLErrorTimedOut].contains(error.code),
            let url = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        else { return }
        controller?.showOffline(webView, url: url)
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(suggestedFilename)
        files[download] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = files.removeValue(forKey: download) else { return }
        controller?.share(file)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        files.removeValue(forKey: download)
    }
}
