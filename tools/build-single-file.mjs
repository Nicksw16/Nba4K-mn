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
  // Piso ES2020 (navegadores de 2020 em diante). Nao fixamos versoes de
  // navegador por nome: o esbuild entao tenta contornar bugs especificos do
  // Safari 13/14 rebaixando destructuring, o que ele ainda nao sabe fazer.
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;

// 2. Le o HTML e inline tudo que viria da rede.
let html = await readFile(resolve(root, 'index.html'), 'utf8');
const sourceCloses = (html.match(/<\/script/gi) || []).length;

const svg = await readFile(resolve(root, 'icon.svg'), 'utf8');
const svgUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const appleIcon = await readFile(resolve(root, 'apple-touch-icon.png'));
const appleUri = `data:image/png;base64,${appleIcon.toString('base64')}`;

// O manifest aponta para arquivos externos: nao faz sentido em arquivo unico.
html = html.replace(/\n\s*<link rel="manifest"[^>]*>/g, '');
// ATENCAO: todas as substituicoes usam FUNCAO, nunca string. Numa string de
// reposicao o `$` e especial ($&, $\', $1...) e o bundle minificado usa `$`
// como nome de variavel — com string, `$&&a` virava o texto casado + `&a`,
// injetando um `</script>` no meio do codigo e matando a pagina inteira.
html = html.replace(/<link rel="apple-touch-icon" href="[^"]*"\s*\/?>/,
  () => `<link rel="apple-touch-icon" href="${appleUri}" />`);
html = html.replace(/<link rel="icon" href="[^"]*"\s*\/?>/,
  () => `<link rel="icon" href="${svgUri}" />`);

// 3. Troca o modulo externo pelo bundle embutido. `</script` dentro de uma
//    string do proprio codigo tambem fecharia a tag: quebramos a sequencia.
const safeJs = js.replace(/<\/(script)/gi, (_m, tag) => `<\\/${tag}`);
html = html.replace(
  /<script type="module" src="[^"]*"><\/script>/,
  () => `<script>\n${safeJs}\n</script>`,
);

// 4. Aviso claro se algo ainda tentar sair para a rede. Checa apenas as tags
//    do documento, nao o conteudo do bundle (que pode conter essas letras).
const head = html.slice(0, html.indexOf('<script>'));
const leftovers = [
  ...head.matchAll(/<script[^>]+src=[^>]*>/g),
  ...head.matchAll(/<link[^>]+href="(?!data:)[^"]*"[^>]*>/g),
].map((m) => m[0]);
// O bundle nao pode acrescentar nenhum fechamento de tag: o documento final
// tem que ter exatamente os mesmos que o index.html original.
const closes = (html.match(/<\/script/gi) || []).length;
if (closes !== sourceCloses) {
  console.error(`ERRO: o documento final tem ${closes} fechamentos de <script> (esperado ${sourceCloses}).`);
  console.error('   Algum trecho do bundle esta encerrando a tag antes da hora.');
  process.exit(1);
}
if (leftovers.length) {
  console.error('ERRO: sobrou referencia externa no HTML, o arquivo unico nao funcionaria offline:');
  for (const l of leftovers) console.error('   ' + l.slice(0, 120));
  process.exit(1);
}

await writeFile(out, html, 'utf8');
const info = await stat(out);
console.log(`Gerado: ${out}`);
console.log(`Tamanho: ${(info.size / 1024 / 1024).toFixed(2)} MB (um unico arquivo, sem dependencias)`);
