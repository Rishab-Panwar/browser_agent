/*
 * background.js — opens the panel, and puts the agent into the tab on demand.
 *
 * The agent is injected when a run starts rather than declared as a content
 * script, so a tab that was open before the extension was installed does not
 * need reloading — one less step for a reviewer to get wrong.
 */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message && message.type === 'inject') {
    chrome.scripting
      .executeScript({ target: { tabId: message.tabId }, files: ['content.js'] })
      .then(() => respond({ ok: true }))
      .catch((error) => respond({ ok: false, error: String(error.message || error) }));
    return true;
  }
  return false;
});
