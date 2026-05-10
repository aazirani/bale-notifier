export const WS_HOOK_SCRIPT = `
(function() {
  var OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    ws.addEventListener('message', function(event) {
      var data = event.data;
      if (data instanceof Blob) {
        data.arrayBuffer().then(function(buf) {
          try {
            window.__baleOnFrame(Array.from(new Uint8Array(buf)));
          } catch (e) {}
        });
      } else if (data instanceof ArrayBuffer) {
        try {
          window.__baleOnFrame(Array.from(new Uint8Array(data)));
        } catch (e) {}
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
