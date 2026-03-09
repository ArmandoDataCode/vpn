// server.js
const WebSocket = require('ws');
const https     = require('https');
const http      = require('http');
const tls       = require('tls');

const PORT      = process.env.PORT || 8080;
const MQTT_HOST = process.env.MQTT_HOST || 'd0181f7f.ala.us-east-1.emqxsl.com';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883');

console.log('===========================================');
console.log(`🚀 MQTT Proxy iniciando en puerto ${PORT}`);
console.log(`📡 Target: ${MQTT_HOST}:${MQTT_PORT}`);
console.log('===========================================');

// ── Servidor HTTP base (necesario para manejar CORS en el upgrade) ─
const server = http.createServer((req, res) => {
  // Headers CORS para cualquier origen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Respuesta para navegadores que abren la URL directamente
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Upgrade Required - Este es un servidor WebSocket MQTT');
});

// ── Servidor WebSocket sobre el servidor HTTP ─────────────────────
const wss = new WebSocket.Server({
  server,
  // ✅ Aceptar cualquier origen (Vercel, localhost, etc.)
  verifyClient: (info) => {
    const origin = info.origin || info.req.headers.origin || 'desconocido';
    console.log(`   Origen de conexión: ${origin}`);
    return true; // acepta todos los orígenes
  },
  // ✅ Aceptar subprotocolo mqtt
  handleProtocols: (protocols) => {
    console.log(`   Subprotocolos: ${[...protocols].join(', ')}`);
    if (protocols.has('mqtt'))      return 'mqtt';
    if (protocols.has('mqttv3.1')) return 'mqttv3.1';
    return false;
  },
});

// ── Test de conectividad al arrancar ─────────────────────────────
const testSock = tls.connect({
  host: MQTT_HOST, port: MQTT_PORT, rejectUnauthorized: false,
});
testSock.on('secureConnect', () => {
  console.log('✅ Conectividad TLS hacia EMQX OK');
  testSock.destroy();
});
testSock.on('error', (e) => {
  console.error(`❌ Sin conectividad TLS: ${e.message}`);
  testSock.destroy();
});

// ── Proxy WebSocket ↔ TCP ─────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || 'desconocido';
  const ip     = req.socket.remoteAddress;
  console.log(`\n🔌 WS conectado | IP: ${ip} | Origen: ${origin}`);
  console.log(`   Protocolo acordado: ${ws.protocol}`);

  const tcp = tls.connect({
    host: MQTT_HOST, port: MQTT_PORT, rejectUnauthorized: false,
  });

  tcp.on('secureConnect', () => console.log('   ✅ TLS→EMQX establecido'));

  tcp.on('data', (data) => {
    console.log(`   ← EMQX: ${data.length} bytes`);
    if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
  });

  ws.on('message', (data, isBinary) => {
    const buf = isBinary ? data : Buffer.from(data);
    console.log(`   → WS: ${buf.length} bytes`);
    if (tcp.writable) tcp.write(buf);
  });

  tcp.on('error', (e) => {
    console.error(`   ❌ TCP error: ${e.message}`);
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
  });

  tcp.on('close', () => {
    console.log('   TCP cerrado');
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
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

// ── Iniciar servidor ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en :${PORT}`);
});

server.on('error', (e) => console.error(`❌ Error servidor: ${e.message}`));
