/**
 * Gera COURTSIDE-LEGACY.html: um unico arquivo que roda com dois cliques.
 *
 * Por que isso e necessario: o cliente usa modulos ES, e o navegador bloqueia
 * `import` quando a pagina vem do disco (file://) por politica de origem. Um
 * servidor resolve, mas exige terminal. Aqui o codigo inteiro e empacotado em
 * um script classico embutido no HTML, sem nenhuma requisicao de rede - entao
 * a restricao simplesmente nao se aplica.
 */
import { build } from 'esbuild';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'COURTSIDE-LEGACY.html');

// 1. Empacota todo o cliente em um bundle IIFE (sem import/export).
const result = await build({
  entryPoints: [resolve(root, 'src/client/main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;

// 2. Le o HTML e inline tudo que viria da rede.
let html = await readFile(resolve(root, 'index.html'), 'utf8');

const svg = await readFile(resolve(root, 'icon.svg'), 'utf8');
const svgUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const appleIcon = await readFile(resolve(root, 'apple-touch-icon.png'));
const appleUri = `data:image/png;base64,${appleIcon.toString('base64')}`;

// O manifest aponta para arquivos externos: nao faz sentido em arquivo unico.
html = html.replace(/\n\s*<link rel="manifest"[^>]*>/g, '');
html = html.replace(/<link rel="apple-touch-icon" href="[^"]*"\s*\/?>/,
  `<link rel="apple-touch-icon" href="${appleUri}" />`);
html = html.replace(/<link rel="icon" href="[^"]*"\s*\/?>/,
  `<link rel="icon" href="${svgUri}" />`);

// 3. Troca o modulo externo pelo bundle embutido.
html = html.replace(
  /<script type="module" src="[^"]*"><\/script>/,
  `<script>\n${js}\n</script>`,
);

// 4. Aviso claro se algo ainda tentar sair para a rede.
if (/<script[^>]+src=/.test(html) || /<link[^>]+href="\.\//.test(html)) {
  console.error('ERRO: sobrou referencia externa no HTML. O arquivo unico nao funcionaria offline.');
  process.exit(1);
}

await writeFile(out, html, 'utf8');
const info = await stat(out);
console.log(`Gerado: ${out}`);
console.log(`Tamanho: ${(info.size / 1024 / 1024).toFixed(2)} MB (um unico arquivo, sem dependencias)`);
