const fs = require('fs');
const https = require('https');
const SerialPort = require('serialport');
const Readline = SerialPort.parsers.Readline;
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const WebSocket = require('ws'); // WebSocket seguro

// Configura os pinos UART
const pinsToConfigure = [
  { pin: 'P9_11', mode: 'uart' },
  { pin: 'P9_13', mode: 'uart' }
];

function configurePins() {
  return Promise.all(pinsToConfigure.map(pin => {
    return new Promise((resolve, reject) => {
      const cmd = `config-pin ${pin.pin} ${pin.mode}`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Erro ao configurar o pino ${pin.pin}: ${stderr}`);
            reject(error);
          } else {
            console.log(`Pino ${pin.pin} configurado para modo ${pin.mode}.`);
            resolve(stdout);
          }
        });
      });
    }));
  }
  
  // Carrega os certificados SSL
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'ca.key')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'ca.crt'))
  };
  
  // Inicializa o servidor HTTPS
  const app = express();
  const server = https.createServer(options, app);
  const wss = new WebSocket.Server({ server });
  
  
  app.use(express.static('public'));
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  
  
  const PORT = 3001;
  server.listen(PORT, () => {
    console.log(`Servidor HTTPS rodando na porta ${PORT}`);
  });
  
  
  const THINGSPEAK_WRITE_KEY = 'REYM6SWM97NOE6TQ';
  
  
  function enviarDadosParaThingSpeak(lat, lon) {
    if (lat === undefined || lon === undefined) return;
  
  
    const url = `https://api.thingspeak.com/update?api_key=${THINGSPEAK_WRITE_KEY}&field4=${lat}&field5=${lon}`;
  
  
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data !== '0') {
          console.log(`Dados enviados para ThingSpeak. Entry ID: ${data}`);
        } else {
            console.error(`Erro ao enviar para ThingSpeak: ${data}`);
        }
      });
    }).on('error', (err) => {
      console.error('Erro no envio para ThingSpeak:', err);
    });
  }
  
  
  let currentLocation = null;
  
  
  wss.on('connection', (ws) => {
    console.log('Cliente WebSocket conectado');
    if (currentLocation) {
      ws.send(JSON.stringify(currentLocation));
    }
  });
  
  
  async function main() {
    try {
      await configurePins();
      console.log('Pinos UART configurados.');
  
  
      const serialPort = new SerialPort('/dev/ttyO4', { baudRate: 9600 });
      const parser = serialPort.pipe(new Readline({ delimiter: '\r\n' }));
    

      serialPort.on('open', () => console.log('Porta serial aberta.'));
      serialPort.on('error', err => console.error('Erro na serial:', err.message));
  
  
      parser.on('data', (data) => {
        data = data.trim();
        if (!data.startsWith('$GNRMC')) return;
  
  
        const fields = data.split(',');
        if (fields.length < 7) return;
  
  
        const lat = fields[3], latDir = fields[4];
        const lon = fields[5], lonDir = fields[6];
  
  
        if (lat && latDir && lon && lonDir) {
          const latDecimal = parseFloat(lat.slice(0, 2)) + parseFloat(lat.slice(2)) / 60;
          const lonDecimal = parseFloat(lon.slice(0, 3)) + parseFloat(lon.slice(3)) / 60;
  
  
          currentLocation = {
            latitude: latDir === 'N' ? latDecimal : -latDecimal,
            longitude: lonDir === 'E' ? lonDecimal : -lonDecimal
          };
          console.log('Localização recebida:', currentLocation);


          // Envia via WebSocket para todos os clientes
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(currentLocation));
            }
          });
        }
      });
  
  
      setInterval(() => {
        if (currentLocation) {
          enviarDadosParaThingSpeak(currentLocation.latitude, currentLocation.longitude);
        }
      }, 15000);
  
  
    } catch (err) {
      console.error('Erro na inicialização:', err);
    }
  }
  
  
  main();
    
  
  
  
  