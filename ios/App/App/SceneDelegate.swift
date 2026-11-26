import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = SuiteMailViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let remaining = Set(URLContexts.filter { !GoogleMail.shared.resume($0.url) })
        SceneDelegateProxy.shared.scene(scene, openURLContexts: remaining)
    }

    func sceneWillEnterForeground(_ scene: UIScene) { BackgroundMail.shared.setForeground(true) }

    func sceneDidEnterBackground(_ scene: UIScene) {
        BackgroundMail.shared.setForeground(false)
        BackgroundMail.shared.schedule()
        #if DEBUG
        BackgroundMail.shared.debugRefreshAfterBackground()
        #endif
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
