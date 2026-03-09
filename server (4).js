// server.js
const WebSocket = require('ws');
const tls       = require('tls');

const PORT      = process.env.PORT || 8080;
const MQTT_HOST = process.env.MQTT_HOST || 'd0181f7f.ala.us-east-1.emqxsl.com';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883');

// ✅ CLAVE: aceptar el subprotocolo 'mqtt' que envía Flutter
const wss = new WebSocket.Server({
  port: PORT,
  handleProtocols: (protocols) => {
    console.log(`   Subprotocolos solicitados: ${[...protocols].join(', ')}`);
    if (protocols.has('mqtt')) return 'mqtt';
    if (protocols.has('mqttv3.1')) return 'mqttv3.1';
    return false;
  },
});

console.log('===========================================');
console.log(`🚀 MQTT Proxy iniciando en puerto ${PORT}`);
console.log(`📡 Target: ${MQTT_HOST}:${MQTT_PORT}`);
console.log('===========================================');

// Test de conectividad al arrancar
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

// Proxy WebSocket ↔ TCP
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`\n🔌 WS conectado desde ${ip}`);
  console.log(`   Protocolo acordado: ${ws.protocol}`);

  const tcp = tls.connect({
    host: MQTT_HOST, port: MQTT_PORT, rejectUnauthorized: false,
  });

  tcp.on('secureConnect', () => {
    console.log('   ✅ TLS→EMQX establecido');
  });

  // EMQX → navegador
  tcp.on('data', (data) => {
    console.log(`   ← EMQX: ${data.length} bytes`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: true });
    }
  });

  // navegador → EMQX
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

wss.on('listening', () => console.log(`✅ Servidor escuchando en :${PORT}`));
wss.on('error',     (e) => console.error(`❌ Error servidor: ${e.message}`));
