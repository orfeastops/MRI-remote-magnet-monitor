import { useEffect, useRef, useCallback, useState } from 'react';

const WS_URL = import.meta.env.PROD
  ? 'wss://hetzner.karnagio.org/ws'
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export function useWebSocket(onMessage) {
  const wsRef      = useRef(null);
  const retryRef   = useRef(null);
  const watchRef   = useRef(null);
  const [online, setOnline] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setOnline(true);
      clearTimeout(retryRef.current);
      if (watchRef.current != null) {
        ws.send(JSON.stringify({ type: 'watch', deviceId: watchRef.current }));
      }
    };

    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch {}
    };

    ws.onclose = () => {
      setOnline(false);
      wsRef.current = null;
      retryRef.current = setTimeout(connect, 4000);
    };

    ws.onerror = () => ws.close();
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const watch = useCallback((deviceId) => {
    watchRef.current = deviceId;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'watch', deviceId }));
    }
  }, []);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { online, watch, send };
}
