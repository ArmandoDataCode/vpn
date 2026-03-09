// server.js
const WebSocket = require('ws');
const http      = require('http');
const tls       = require('tls');

const PORT      = process.env.PORT || 8080;
const MQTT_HOST = process.env.MQTT_HOST || 'd0181f7f.ala.us-east-1.emqxsl.com';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883');

console.log('===========================================');
console.log(`🚀 MQTT Proxy en puerto ${PORT}`);
console.log(`📡 Target: ${MQTT_HOST}:${MQTT_PORT}`);
console.log('===========================================');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('WebSocket MQTT Proxy');
});

const wss = new WebSocket.Server({
  server,
  verifyClient: (info) => {
    console.log(`   Origen: ${info.origin || 'desconocido'}`);
    return true;
  },
  handleProtocols: (protocols) => {
    console.log(`   Subprotocolos: ${[...protocols].join(', ')}`);
    if (protocols.has('mqtt'))      return 'mqtt';
    if (protocols.has('mqttv3.1')) return 'mqttv3.1';
    return 'mqtt'; // aceptar igual aunque no especifique
  },
});

// Test de conectividad al arrancar
const testSock = tls.connect({ host: MQTT_HOST, port: MQTT_PORT, rejectUnauthorized: false });
testSock.on('secureConnect', () => { console.log('✅ Conectividad TLS OK'); testSock.destroy(); });
testSock.on('error', (e) => { console.error(`❌ TLS error: ${e.message}`); testSock.destroy(); });

wss.on('connection', (ws, req) => {
  console.log(`\n🔌 WS conectado | Origen: ${req.headers.origin || 'desconocido'}`);

  // ✅ Cola para guardar paquetes que llegan antes de que TLS esté listo
  const queue  = [];
  let tcpReady = false;

  const tcp = tls.connect({
    host: MQTT_HOST, port: MQTT_PORT, rejectUnauthorized: false,
  });

  tcp.on('secureConnect', () => {
    tcpReady = true;
    console.log(`   ✅ TLS→EMQX listo — enviando ${queue.length} paquetes en cola`);
    // Vaciar la cola
    while (queue.length > 0) {
      const buf = queue.shift();
      console.log(`   → Cola→EMQX: ${buf.length} bytes`);
      tcp.write(buf);
    }
  });

  // EMQX → navegador
  tcp.on('data', (data) => {
    console.log(`   ← EMQX: ${data.length} bytes`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: true });
    }
  });

  // Navegador → EMQX (con cola si TLS no está listo)
  ws.on('message', (data, isBinary) => {
    const buf = isBinary ? data : Buffer.from(data);
    console.log(`   → WS: ${buf.length} bytes (tcpReady=${tcpReady})`);
    if (tcpReady && tcp.writable) {
      tcp.write(buf);
    } else {
      // TLS todavía conectando — guardar en cola
      console.log(`   ⏳ En cola: ${buf.length} bytes`);
      queue.push(buf);
    }
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

server.listen(PORT, () => console.log(`✅ Servidor escuchando en :${PORT}`));
server.on('error', (e) => console.error(`❌ Error servidor: ${e.message}`));
