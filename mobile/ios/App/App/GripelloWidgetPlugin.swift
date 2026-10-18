import Capacitor
import WidgetKit

// The web app (app/utils/widget.ts) hands its session to the home-screen widget and asks it to redraw.
@objc(GripelloWidgetPlugin)
public class GripelloWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GripelloWidgetPlugin"
    public let jsName = "GripelloWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
    ]

    @objc func setSession(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let userId = call.getString("userId"),
              let origin = call.getString("origin") else {
            return call.reject("token, userId and origin are required")
        }
        WidgetStore.saveSession(.init(token: token, userId: userId, origin: origin))
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        WidgetStore.clearSession()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func reload(_ call: CAPPluginCall) {
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
