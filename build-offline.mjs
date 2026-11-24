import fs from 'node:fs/promises';
import path from 'node:path';
const destination = process.argv[2];
if (!destination) throw new Error('Pass the destination HTML path.');
const dir = new URL('./docs/',import.meta.url);
let html = await fs.readFile(new URL('index.html',dir),'utf8');
const css = await fs.readFile(new URL('style.css',dir),'utf8');
const engine = (await fs.readFile(new URL('engine.mjs',dir),'utf8')).replaceAll('export ','');
let app = (await fs.readFile(new URL('app.mjs',dir),'utf8')).replace(/^import[^\n]+\n/,'');
const sources = {};
for(const name of ['title-original','lake','underwater','culter']){
  sources[name] = 'data:image/png;base64,'+(await fs.readFile(new URL(`assets/${name}.png`,dir))).toString('base64');
}
html = html.replace(/<link rel="preload"[^>]+>/,'');
html = html.replace('<link rel="stylesheet" href="style.css">',`<style>${css}</style>`);
html = html.replace(/src="assets\/([^"]+)\.png"/g,(_,name)=>`src="${sources[name]}"`);
app = app.replace('img.src = `assets/${name}.png`;', 'img.src = imageSources[name];');
const imageSources = {lake:sources.lake,underwater:sources.underwater,culter:sources.culter};
const script = `(()=>{\nconst imageSources=${JSON.stringify(imageSources)};\n${engine}\n${app}\n})();`;
html = html.replace('<script type="module" src="app.mjs"></script>',`<script>${script.replaceAll('</script','<\\/script')}</script>`);
await fs.mkdir(path.dirname(destination),{recursive:true});
await fs.writeFile(destination,html);
console.log(`Offline build created: ${destination}`);
