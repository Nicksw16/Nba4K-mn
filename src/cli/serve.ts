/** Servidor estatico minimo para rodar o cliente localmente. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT ?? 8080);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** Enderecos da maquina na rede local: e por eles que o celular entra. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      out.push(net.address);
    }
  }
  return out;
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(root, normalize(urlPath === '/' ? '/index.html' : urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Nao encontrado');
  }
});

server.listen(port, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log('');
  console.log('  COURTSIDE: LEGACY');
  console.log('  ' + '='.repeat(52));
  console.log(`  Neste computador:  http://localhost:${port}`);
  if (lan.length) {
    console.log('');
    console.log('  NO CELULAR (mesma rede Wi-Fi), abra:');
    for (const ip of lan) console.log(`     http://${ip}:${port}`);
    console.log('');
    console.log('  Dica: no celular, use "Adicionar a tela de inicio" para');
    console.log('  abrir em tela cheia, sem a barra do navegador.');
  } else {
    console.log('');
    console.log('  Nenhuma rede local detectada. Para jogar no celular,');
    console.log('  conecte o computador ao Wi-Fi e reinicie o servidor.');
  }
  console.log('');
  console.log('  Para parar: Ctrl+C');
  console.log('');
});
