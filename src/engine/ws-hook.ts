export const WS_HOOK_SCRIPT = `
(function() {
  var OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    ws.addEventListener('message', function(event) {
      if (event.data instanceof ArrayBuffer) {
        try {
          window.__baleOnFrame(Array.from(new Uint8Array(event.data)));
        } catch (e) {
          // __baleOnFrame might not be ready yet during handshake
        }
      }
    });

    return ws;
  };

  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket.prototype = OriginalWebSocket.prototype;
})();
`;
