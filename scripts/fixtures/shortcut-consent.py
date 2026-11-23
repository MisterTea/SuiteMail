"""Inspect or activate a shortcut-consent button in a disposable GNOME session."""
import json
import os
import sys
import pyatspi

if os.environ.get("SUITEMAIL_ISOLATED_DESKTOP_TEST") != "1":
    raise SystemExit("This helper requires a disposable desktop test session")

requested = sys.argv[1] if len(sys.argv) > 1 else None
if requested is not None and requested not in ("Allow", "Add", "Deny", "Cancel"):
    raise SystemExit("Expected Allow, Add, Deny, or Cancel")

buttons = []
clicked = None
count = 0

def visit(node):
    global count, clicked
    count += 1
    if count > 3000:
        return
    try:
        if node.getRole() == pyatspi.ROLE_PUSH_BUTTON:
            name = node.name
            if node.getState().contains(pyatspi.STATE_VISIBLE):
                buttons.append(name)
                if name == requested and clicked is None:
                    action = node.queryAction()
                    if action.doAction(0):
                        clicked = name
        for child in node:
            visit(child)
    except (RuntimeError, AttributeError, NotImplementedError):
        pass

desktop = pyatspi.Registry.getDesktop(0)
applications = []
for app in desktop:
    applications.append(app.name)
    if "setting" in app.name.lower() or "shortcut" in app.name.lower():
        visit(app)
print(json.dumps({"applications": applications, "buttons": buttons, "clicked": clicked}))
