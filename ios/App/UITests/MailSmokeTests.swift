import XCTest

final class MailSmokeTests: XCTestCase {
    func testSavedMailSearchAndDraftSurviveRelaunch() {
        let app = XCUIApplication()
        app.launch()

        let cancel = app.buttons["Cancel"]
        if cancel.waitForExistence(timeout: 4) { cancel.tap() }

        tap(app.buttons["Settings"])
        tap(app.buttons["Accounts"])
        let sandbox = app.descendants(matching: .any).matching(identifier: "Enable sandbox account").firstMatch
        XCTAssertTrue(sandbox.waitForExistence(timeout: 10))
        continueAfterFailure = false
        if sandbox.value as? String != "1" {
            sandbox.tap()
        } else {
            tap(app.buttons["Back to Inbox"])
        }

        XCTAssertTrue(mailContaining("Project update: Orion 1", in: app).waitForExistence(timeout: 15))
        let search = app.descendants(matching: .any).matching(identifier: "Search mail").firstMatch
        tap(search)
        search.typeText("Invoice ready\n")
        XCTAssertTrue(mailContaining("Invoice ready: Orion 3", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(mailContaining("Lunch plans: Orion 2", in: app).exists)
        let clear = app.buttons["Clear search"].firstMatch
        if clear.exists {
            clear.tap()
            search.typeText("\n")
        }

        tap(app.buttons["Compose email"].firstMatch)
        let subject = app.textFields["Subject"].firstMatch
        tap(subject)
        let draftSubject = "Simulator draft " + UUID().uuidString
        app.typeText(draftSubject)
        XCTAssertEqual(subject.value as? String, draftSubject)
        tap(app.buttons["Save & close"].firstMatch)

        app.terminate()
        app.launch()
        tap(app.buttons["Open folders menu"].firstMatch)
        tap(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Drafts")).firstMatch)
        tap(app.buttons[draftSubject].firstMatch)
        XCTAssertEqual(app.textFields["Subject"].firstMatch.value as? String, draftSubject)

        let recipient = app.textFields["To"].firstMatch
        tap(recipient)
        app.typeText("friend@sandbox.test\n")
        XCTAssertTrue(app.buttons["Remove friend@sandbox.test"].exists)
        tap(app.buttons["Send"].firstMatch)
        let inbox = app.buttons["Inbox"].firstMatch
        tap(inbox)
        XCTAssertTrue(mailContaining(draftSubject, in: app).waitForExistence(timeout: 15))
    }

    private func mailContaining(_ subject: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch
    }

    private func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(element)", file: file, line: line)
        element.tap()
    }
}
