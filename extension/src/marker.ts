// Runs on Student OS pages only (registered for the Student OS address by the
// background worker). It tells the page the extension is installed, so onboarding
// can move on by itself: a data attribute with the extension's version, and an
// event. Nothing is read from the page and nothing else is shared.
document.documentElement.dataset.studentOsExtension = chrome.runtime.getManifest().version
document.dispatchEvent(new CustomEvent("student-os-extension"))
