// Valida o parser do centranovel sobre os provider-chapters.json salvos pelo audit do Mahou Reader.
// Reconstrói o HTML (.eplister li > a > .epl-num / .epl-title) a partir de label/título/url salvos,
// roda o parseVolumesFromPage REAL e aplica a mesma normalização do Reader (lib/crawler.mjs).
// Nada de rede, nada de banco. Uso:
//   node scripts/validate-centralnovel-saved.js [--parser=caminho.js] [--root=<dir centralnovel>] [--json=saida.json]
require('module-alias/register');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');

const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || d;
const parserPath = path.resolve(arg('parser', 'src/source/ptbr/centranovel.js'));
const root = arg('root', '/home/harry/mahou-reader/data/provider-sync/centralnovel');
const outJson = arg('json', '');
const readerDir = arg('reader', '/home/harry/mahou-reader');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

(async () => {
    const store = await import(path.join(readerDir, 'scripts/provider-sync/lib/store.mjs'));
    const Provider = require(parserPath);
    const provider = typeof Provider === "function" ? new Provider() : Provider;
    const normalizeNumber = v => Number(v) || 0;

    const files = [];
    for (const cat of fs.readdirSync(root)) {
        const dc = path.join(root, cat);
        if (!fs.statSync(dc).isDirectory()) continue;
        for (const obra of fs.readdirSync(dc)) {
            const f = path.join(dc, obra, 'provider-chapters.json');
            if (fs.existsSync(f)) files.push([obra, f]);
        }
    }

    const rows = [];
    for (const [obra, f] of files) {
        const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
        // Salvo está na ordem de leitura; o site lista do mais novo pro mais antigo.
        const html = '<ul class="eplister">' + [...saved].reverse().map(c =>
            `<li><a href="${esc(c.url)}"><div class="epl-num">${esc(c.label)}</div><div class="epl-title">${esc(c.title)}</div></a></li>`
        ).join('') + '</ul>';
        const { volumes } = provider.parseVolumesFromPage(cheerio.load(html));
        const brutos = volumes.flatMap(v => v.chapters.map(ch => ({
            title: ch.name, url: ch.url, index: ch.index, volume: ch.volume, label: ch.capitulo,
        })));
        // Mesma normalização de scripts/provider-sync/lib/crawler.mjs (fetchProviderChapters).
        const maiorParte = new Map();
        for (const b of brutos) {
            const { chapter, part } = store.parseChapterLabel(b.label);
            if (!Number.isFinite(chapter) || part === null) continue;
            maiorParte.set(chapter, Math.max(maiorParte.get(chapter) ?? 0, part));
        }
        const out = brutos.map(b => {
            const { chapter, part } = store.parseChapterLabel(b.label);
            const divisor = part === null ? 10 : store.partDivisor(maiorParte.get(chapter) ?? part);
            return {
                url: b.url, label: b.label,
                index: store.resolveChapterIndex(b.label, normalizeNumber(b.index), divisor),
                volume: normalizeNumber(b.volume),
            };
        });
        const keys = new Map();
        for (const c of out) { const k = `${c.volume}::${c.index}`; keys.set(k, (keys.get(k) || 0) + 1); }
        const dupExcess = out.length - keys.size;
        const savedByUrl = new Map(saved.map(c => [c.url, c]));
        let same = 0, diffIdx = 0, diffVol = 0; const changes = [];
        for (const c of out) {
            const s = savedByUrl.get(c.url);
            if (!s) continue;
            if (s.index === c.index && s.volume === c.volume) same++;
            else { if (s.index !== c.index) diffIdx++; if (s.volume !== c.volume) diffVol++; changes.push({ url: c.url, label: c.label, from: [s.volume, s.index], to: [c.volume, c.index] }); }
        }
        rows.push({ obra, total: out.length, saved: saved.length, dupExcess, same, diffIdx, diffVol, changes });
    }
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    console.log(`parser=${path.basename(parserPath)} obras=${rows.length} rotulos=${sum('total')} (salvos ${sum('saved')})`);
    console.log(`linhas excedentes por chave (volume,indice) duplicada: ${sum('dupExcess')} em ${rows.filter(r => r.dupExcess).length} obras`);
    console.log(`identicos ao salvo: ${sum('same')} | indice mudou: ${sum('diffIdx')} | volume mudou: ${sum('diffVol')}`);
    for (const r of rows.filter(r => r.dupExcess || r.diffIdx || r.diffVol)) console.log(`  ${r.obra}: dup=${r.dupExcess} idx~${r.diffIdx} vol~${r.diffVol}`);
    if (outJson) fs.writeFileSync(outJson, JSON.stringify(rows, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
