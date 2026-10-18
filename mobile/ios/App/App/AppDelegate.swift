import Capacitor
import FirebaseCore
import FirebaseMessaging
import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // GoogleService-Info.plist stays out of git; a build without it has no native push (pushDevice.ts asks the server first).
    private let firebase = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if firebase { FirebaseApp.configure() }
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // The backend sends through FCM on both platforms, so the push plugin hands out the FCM token instead of the APNs one.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard firebase else {
            return failRegistration(NSError(domain: "app.gripello", code: 1, userInfo: [NSLocalizedDescriptionKey: "Firebase is not configured"]))
        }
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, error in
            if let token {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            } else if let error {
                self.failRegistration(error)
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        failRegistration(error)
    }

    private func failRegistration(_ error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
