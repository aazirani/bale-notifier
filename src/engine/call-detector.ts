import type { Page } from "puppeteer";

export const CALL_DETECTOR_SCRIPT = `
(function() {
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (!m.addedNodes) continue;
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
            window.__baleOnCall({ callerName: callerName });
            return;
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window.__baleCallObserver = observer;
})();
`;

export async function startCallDetection(
  page: Page,
  onCall: (callerName: string) => void,
): Promise<() => void> {
  await page.exposeFunction("__baleOnCall", (data: { callerName: string }) => {
    onCall(data.callerName);
  });

  await page.evaluate(CALL_DETECTOR_SCRIPT);

  return async () => {
    await page.evaluate(`
      if (window.__baleCallObserver) {
        window.__baleCallObserver.disconnect();
        window.__baleCallObserver = null;
      }
    `).catch(() => {});
  };
}
