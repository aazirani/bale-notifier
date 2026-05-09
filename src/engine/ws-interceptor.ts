import type { Page } from "puppeteer";
import type { DomNotification } from "../types.js";
import { BADGE_SCAN_INTERVAL_MS } from "../constants.js";

export const MONITOR_SCRIPT = `
(function() {
  var lastKnownState = {};
  var lastNotified = {};

  function findDialogContainer(el) {
    var container = el;
    for (var w = 0; w < 8; w++) {
      if (!container || !container.parentElement) break;
      container = container.parentElement;
      var cls = (typeof container.className === 'string') ? container.className : '';
      if (cls.indexOf('dialog-item') !== -1) return container;
    }
    return null;
  }

  function extractChatName(container) {
    if (!container || !container.firstElementChild || !container.firstElementChild.firstElementChild) {
      return 'Unknown';
    }
    var nameRow = container.firstElementChild.firstElementChild;
    if (nameRow.firstElementChild) {
      return (nameRow.firstElementChild.textContent || '').trim();
    }
    var raw = (nameRow.textContent || '').trim();
    var i = raw.length - 5;
    if (i > 0 && raw.charAt(i + 2) === ':') {
      var t = raw.substring(i);
      if (t.charAt(0) >= '0' && t.charAt(0) <= '9' && t.charAt(1) >= '0' && t.charAt(1) <= '9'
        && t.charAt(3) >= '0' && t.charAt(3) <= '9' && t.charAt(4) >= '0' && t.charAt(4) <= '9') {
        return raw.substring(0, i).trim();
      }
    }
    return raw;
  }

  function extractMessagePreview(container) {
    if (!container || !container.firstElementChild) return undefined;
    var contentRow = container.firstElementChild;
    var previewRow = null;
    var child = contentRow.firstElementChild;
    while (child) {
      var next = child.nextElementSibling;
      if (next) { previewRow = next; break; }
      child = next;
    }
    if (!previewRow) return undefined;
    var fullText = (previewRow.textContent || '').trim();
    var stripped = fullText.replace(/[0-9]+$/, '').trim();
    if (stripped.length > 0 && stripped.length < 200) return stripped;
    return undefined;
  }

  function extractChatUrl(container) {
    if (!container) return undefined;
    var wrapper = container;
    for (var w = 0; w < 5; w++) {
      if (!wrapper || !wrapper.parentElement) break;
      wrapper = wrapper.parentElement;
    }
    if (!wrapper) return undefined;
    var el = container;
    for (var r = 0; r < 8; r++) {
      if (!el) break;
      var keys = Object.keys(el);
      for (var ki = 0; ki < keys.length; ki++) {
        if (keys[ki].indexOf('__react') !== -1) {
          var fiber = el[keys[ki]];
          var node = fiber;
          for (var f = 0; f < 10; f++) {
            if (!node) break;
            var props = node.memoizedProps || node.pendingProps || {};
            var uid = props.uid || props.peerId || props.chatId || props.userId || props.id;
            if (uid && typeof uid === 'string' && uid.length > 0) {
              return 'https://web.bale.ai/contacts?uid=' + uid;
            }
            if (typeof uid === 'number' && uid > 0) {
              return 'https://web.bale.ai/contacts?uid=' + uid;
            }
            node = node.return || node.child;
          }
        }
      }
      el = el.parentElement;
    }
    return undefined;
  }

  function tryNotify(chatName, count, preview, chatUrl) {
    if (!chatName || count <= 0) return;
    var last = lastNotified[chatName];
    if (last && last.preview === preview) return;
    lastNotified[chatName] = { preview: preview, timestamp: Date.now() };
    window.__baleNotify({
      type: 'unread_badge_change',
      unreadCount: count,
      chatName: chatName,
      messagePreview: preview || undefined,
      chatUrl: chatUrl || undefined
    });
  }

  function handleBadgeEl(badgeEl, forceNum) {
    var text = forceNum !== undefined ? String(forceNum) : (badgeEl.textContent || '').trim();
    var num = forceNum !== undefined ? forceNum : parseInt(text, 10);
    if (isNaN(num) || text.length > 3) return;

    var container = findDialogContainer(badgeEl);
    var chatName = container ? extractChatName(container) : null;

    if (num === 0) {
      if (chatName) lastKnownState[chatName] = 0;
      return;
    }
    if (!chatName) return;

    var preview = container ? extractMessagePreview(container) : undefined;
    var chatUrl = container ? extractChatUrl(container) : undefined;
    var lastCount = chatName in lastKnownState ? lastKnownState[chatName] : -1;
    lastKnownState[chatName] = num;

    if (num > lastCount) {
      tryNotify(chatName, num, preview, chatUrl);
    }
  }

  function scanAllBadges() {
    var badges = document.querySelectorAll('[class*="eVv8xC"]');
    var seenChats = {};
    for (var i = 0; i < badges.length; i++) {
      var badge = badges[i];
      var text = (badge.textContent || '').trim();
      var num = parseInt(text, 10);
      if (isNaN(num) || text.length > 3 || num <= 0) continue;
      var container = findDialogContainer(badge);
      var chatName = container ? extractChatName(container) : null;
      if (!chatName) continue;
      seenChats[chatName] = true;
      var lastCount = chatName in lastKnownState ? lastKnownState[chatName] : -1;
      lastKnownState[chatName] = num;
      if (num > lastCount) {
        var preview = container ? extractMessagePreview(container) : undefined;
        var chatUrl = container ? extractChatUrl(container) : undefined;
        tryNotify(chatName, num, preview, chatUrl);
      }
    }
    for (var key in lastKnownState) {
      if (!seenChats[key] && lastKnownState[key] > 0) {
        lastKnownState[key] = 0;
      }
    }
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      // --- Incoming call ---
      if (m.addedNodes) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType !== 1) continue;
          var callModals = [];
          if (node.querySelector) {
            var found = node.querySelector('[class*="CallModal"]');
            if (found) callModals.push(found);
          }
          if (node.className && typeof node.className === 'string' && node.className.indexOf('CallModal') !== -1) {
            callModals.push(node);
          }
          for (var k = 0; k < callModals.length; k++) {
            var modal = callModals[k];
            var modalText = (modal.textContent || '').trim();
            if (modalText.indexOf('Answer') !== -1 && modalText.indexOf('Decline') !== -1) {
              var callerEl = document.querySelector('.HOE2x2');
              var callerName = callerEl
                ? callerEl.textContent.trim()
                : modalText.replace(/Answer/g, '').replace(/Decline/g, '').trim();
              window.__baleNotify({ type: 'incoming_call', callerName: callerName });
              return;
            }
          }

          // --- Badge element added ---
          if (node.querySelector) {
            var addedBadges = node.querySelectorAll('[class*="eVv8xC"]');
            for (var b = 0; b < addedBadges.length; b++) {
              handleBadgeEl(addedBadges[b]);
            }
          }
          if (node.className && typeof node.className === 'string' && node.className.indexOf('eVv8xC') !== -1) {
            handleBadgeEl(node);
          }
        }
      }

      // --- Unread badge text changed ---
      if (m.type === 'characterData' && m.target && m.target.parentElement) {
        var text = m.target.textContent.trim();
        var num = parseInt(text, 10);
        if (!isNaN(num) && text.length <= 3 && num >= 0) {
          handleBadgeEl(m.target.parentElement, num);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.__baleObserver = observer;
  window.__baleScannerInterval = setInterval(scanAllBadges, ${BADGE_SCAN_INTERVAL_MS});
})()
`;

export async function startDomMonitoring(
  page: Page,
  onNotification: (notification: DomNotification) => void,
): Promise<() => void> {
  await page.exposeFunction("__baleNotify", (data: DomNotification) => {
    onNotification(data);
  });

  await page.evaluate(MONITOR_SCRIPT);

  return async () => {
    await page.evaluate(`
      if (window.__baleObserver) {
        window.__baleObserver.disconnect();
        window.__baleObserver = null;
      }
      if (window.__baleScannerInterval) {
        clearInterval(window.__baleScannerInterval);
        window.__baleScannerInterval = null;
      }
    `).catch(() => {});
  };
}
