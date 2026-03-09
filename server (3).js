// server.js
const WebSocket = require('ws');
const tls       = require('tls');

const PORT      = process.env.PORT || 8080;
const MQTT_HOST = process.env.MQTT_HOST || 'd0181f7f.ala.us-east-1.emqxsl.com';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883');

const wss = new WebSocket.Server({ port: PORT });

console.log('===========================================');
console.log(`🚀 MQTT Proxy iniciando en puerto ${PORT}`);
console.log(`📡 Target: ${MQTT_HOST}:${MQTT_PORT}`);
console.log('===========================================');

// ── Test de conectividad al arrancar ─────────────────────────────
const testSock = tls.connect({ host: MQTT_HOST, port: MQTT_PORT, rejectUnauthorized: false });
testSock.on('secureConnect', () => {
  console.log(`✅ Conectividad TLS hacia EMQX OK`);
  testSock.destroy();
});
testSock.on('error', (e) => {
  console.error(`❌ Sin conectividad TLS hacia EMQX: ${e.message} [${e.code}]`);
  testSock.destroy();
});

// ── Proxy WebSocket ───────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const ip   = req.socket.remoteAddress;
  const proto = req.headers['sec-websocket-protocol'] || 'ninguno';
  console.log(`\n🔌 WS conectado desde ${ip} | protocolo: ${proto}`);

  const tcp = tls.connect({
    host:               MQTT_HOST,
    port:               MQTT_PORT,
    rejectUnauthorized: false,
  });

  tcp.on('secureConnect', () => console.log(`   ✅ TLS→EMQX establecido`));

  tcp.on('data', (data) => {
    console.log(`   ← EMQX: ${data.length} bytes`);
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  tcp.on('error', (e) => {
    console.error(`   ❌ TCP error: ${e.message} [${e.code}]`);
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
  });

  tcp.on('close', () => {
    console.log(`   TCP cerrado`);
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
  });

  ws.on('message', (data) => {
    console.log(`   → WS: ${data.length} bytes`);
    if (tcp.writable) tcp.write(data instanceof Buffer ? data : Buffer.from(data));
  });

  ws.on('close', (code) => {
    console.log(`   WS cerrado. code: ${code}`);
    tcp.destroy();
  });

  ws.on('error', (e) => {
    console.error(`   ❌ WS error: ${e.message}`);
    tcp.destroy();
  });
});

wss.on('listening', () => console.log(`✅ Servidor escuchando en :${PORT}`));
wss.on('error',     (e) => console.error(`❌ Error servidor: ${e.message}`));
