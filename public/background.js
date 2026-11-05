// Opens an optional feedback form after Cue is uninstalled. Chrome stores the URL
// and opens it itself; the extension sends nothing and runs no code at that point.
const UNINSTALL_FEEDBACK_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSe0zkguGUwoN9AaCYjgD2v0HRJ5C_XGwbhdtPy9_mi57viWLw/viewform';

chrome.runtime.onInstalled.addListener(() => {
  chrome.runtime.setUninstallURL(UNINSTALL_FEEDBACK_URL);
});
