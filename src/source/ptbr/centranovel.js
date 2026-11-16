const axios = require("axios");
const cheerio = require("cheerio");
const https = require('https');
const BaseProvider = require('@/template/BaseProvider');
const cache = require('@/utils/cache');
const cacheKeys = require('@/utils/cacheKeys');
const cacheTTL = require('@/utils/cacheConfig');

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false // Ignora a verificação do certificado
    })
});

class CentraNovelProvider extends BaseProvider {
    constructor() {
        super('centralnovel', 'https://centralnovel.com', 'novel');
        this.wpApiUrl = `${this.baseUrl}/wp-json/wp/v2`;
    }

    // Converte números tipo "1.7.6" (algumas obras numeram capítulo.seção.subseção,
    // não só capítulo.subcapítulo) num float comparável, sem colidir. parseFloat comum
    // trunca no segundo ponto ("1.7.6" -> 1.7), fazendo 1.7.1..1.7.9 virarem tudo igual.
    // Aqui cada nível vale 1/1000 do anterior — margem enorme pra qualquer sub-número.
    // Também trata sufixo de letra ("124A"/"124B" -> vira mais um nível: A=1, B=2...),
    // já que parseInt sozinho ignora a letra e faria os dois virarem 124.
    parseVersionNumber(str) {
        const segments = str.replace(',', '.').split('.');
        const parts = [];

        for (const segment of segments) {
            const match = segment.match(/^(\d+)([a-zA-Z]*)$/);
            if (!match) return null;

            parts.push(parseInt(match[1], 10));
            if (match[2]) {
                parts.push(match[2].toUpperCase().charCodeAt(0) - 64);
            }
        }

        return parts.length ? parts.reduce((acc, part, i) => acc + part / Math.pow(1000, i), 0) : null;
    }

    // Extrai o slug (última parte do path) de uma url absoluta ou relativa
    extractSlug(url) {
        const path = url.replace(this.baseUrl, '');
        const segments = path.split('/').filter(Boolean);
        return segments[segments.length - 1];
    }

    // Caixa de busca ao vivo do próprio site (POST em admin-ajax.php). Limitada a 10
    // resultados, mas já vem com gênero e imagem — não precisa enriquecer depois.
    async searchNovel(query) {
        try {
            const body = new URLSearchParams({ action: 'ts_ac_do_search', ts_ac_query: query }).toString();
            const { data } = await axiosInstance.post(
                `${this.baseUrl}/wp-admin/admin-ajax.php`,
                body,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const items = data?.series?.[0]?.all || [];
            return items.map(item => ({
                url: item.post_link,
                title: item.post_title,
                chapter: null,
                imageUrl: item.post_image ? item.post_image.split('?')[0] : null,
                rating: null,
                genre: item.post_genres ? item.post_genres.split(',').map(g => g.trim()) : [],
            }));
        } catch (error) {
            console.error("Erro ao buscar o conteúdo:", error.message);
            throw error;
        }
    }

    async readNovelInfo(novelUrl) {
        try {
            const fullUrl = this.getFullUrl(novelUrl);
            const { data } = await axiosInstance.get(fullUrl);
            const $ = cheerio.load(data);

            const title = this.parseTitle($);
            const coverUrl = this.parseCover($);
            const authors = this.parseAuthors($);
            const synopsis = $('.entry-content').text().trim();
            const titles = $('.ninfo .alter').text().trim().split(',').filter(Boolean);

            const genres = [];
            $('.genxed a').each((index, element) => {
                genres.push($(element).text().trim());
            });

            const { volumes, orderedChapterUrls } = this.parseVolumesFromPage($);

            if (orderedChapterUrls.length > 0) {
                await this.cacheChapterPositions(orderedChapterUrls);
            }

            return {
                title,
                coverUrl,
                author: authors,
                titles,
                genres,
                synopsis,
                volumes: volumes.length,
                data: volumes,
                chapters: volumes.reduce((sum, vol) => sum + vol.chapters.length, 0)
            };
        } catch (error) {
            console.error("Erro ao buscar os capítulos:", error.message);
            throw error;
        }
    }

    // A própria página da obra já traz todos os capítulos embutidos no HTML (accordion
    // por volume, escondido via CSS) — confirmado até em obras com 3000+ capítulos.
    // Usa o rótulo de volume como veio no site ("13", "Extra", ...) em vez de tentar
    // extrair do título do post na REST API, que varia de obra pra obra (algumas nem
    // colocam "Volume" no título, só "Capítulo N").
    parseVolumesFromPage($) {
        const rawChapters = [];

        $('.eplister li').each((index, element) => {
            const chapterUrl = $(element).find('a').attr('href');
            if (!chapterUrl) return;

            const chapterNum = $(element).find('.epl-num').text().trim();
            const chapterTitle = $(element).find('.epl-title').text().trim();
            const volumeMatch = chapterNum.match(/Vol\.\s*(.+?)\s*Cap\./i);
            // Só o número (com sufixo de letra opcional) — o site marca o capítulo
            // final com uma tag depois do número ("Cap. 529 [Fim]"), e ".+$" pegava
            // a tag junto, quebrando o parseVersionNumber (que aí retornava null e
            // o capítulo caía no ramo "sem número").
            // O `(?:\s*-\s*(\d+))?` é o número da PARTE: obras como Heavenly Jewel Change
            // publicam "Cap. 14-1", "14-2", "14-3" como três páginas distintas — sem
            // capturar isso, as três viram index 14 e colapsam numa chave só.
            const capMatch = chapterNum.match(/Cap\.\s*([\d.,]+[a-zA-Z]?)(?:\s*-\s*(\d+))?/i);

            // Número real do capítulo como o site mostra (ex: "Cap. 600" -> 600). Usa
            // isso como index sempre que der — assim fica estável mesmo se o site
            // pular um número e lançar depois (ex: tem 1-49 e 51-100, e o 50 sai mais
            // tarde: o 51 continua sendo 51, não desloca por causa do furo).
            const parsedNum = capMatch ? this.parseVersionNumber(capMatch[1].trim()) : null;
            const parsedPart = capMatch && capMatch[2] !== undefined ? parseInt(capMatch[2], 10) : null;

            rawChapters.push({
                url: chapterUrl,
                capitulo: chapterNum,
                name: chapterTitle,
                volumeLabel: volumeMatch ? volumeMatch[1].trim() : null,
                realIndex: parsedNum,
                part: Number.isNaN(parsedPart) ? null : parsedPart,
            });
        });

        // A listagem do site vem do mais novo pro mais antigo — inverte pra ordem real
        // de leitura (também vira a base da posição global de cada capítulo na obra).
        rawChapters.reverse();

        // Capítulo dividido em partes: a parte entra como decimal na base 10 ("14-3" -> 14.3),
        // ordenando certo junto do capítulo inteiro (14.3 < 15.1) e sem confundir com a notação
        // de ponto do site ("Cap. 14.3" já vem como 14.003 do parseVersionNumber — essa fica como
        // está). O divisor depende do MAIOR número de parte daquele capítulo (não da parte em si),
        // senão a parte 10 de um capítulo de 10+ partes colidiria com a parte 1 (14.1 == 14 + 10/100).
        // Chave com o volume junto porque a numeração reinicia por volume em várias obras.
        const partKey = (chapter) => `${chapter.volumeLabel ?? 'no-volume'}|${chapter.realIndex}`;
        const maiorParteByChapter = new Map();
        for (const chapter of rawChapters) {
            if (chapter.part === null || chapter.realIndex === null) continue;
            const key = partKey(chapter);
            maiorParteByChapter.set(key, Math.max(maiorParteByChapter.get(key) ?? 0, chapter.part));
        }

        const volumes = [];
        const volumeIndexByLabel = new Map();
        const lastNumericIndexByVolume = new Map();
        const nonNumericStreakByVolume = new Map();

        rawChapters.forEach(chapter => {
            const key = chapter.volumeLabel ?? 'no-volume';
            if (!volumeIndexByLabel.has(key)) {
                volumeIndexByLabel.set(key, volumes.length);
                lastNumericIndexByVolume.set(key, 0);
                nonNumericStreakByVolume.set(key, 0);
                volumes.push({
                    name: chapter.volumeLabel ? `Volume ${chapter.volumeLabel}` : 'Capítulos',
                    slug: this.slugifyString(chapter.volumeLabel ? `Volume ${chapter.volumeLabel}` : 'Capítulos'),
                    chapters: []
                });
            }

            const volume = volumes[volumeIndexByLabel.get(key)];

            // Sem número real (Prólogo/Posfácio/Interlúdio/Extra sem dígito): ancora
            // logo depois do último capítulo numerado visto até aqui. Vários seguidos
            // (ex: Interlúdio, Extra 1, Extra 2...) usam um contador de sequência pra
            // não colidir entre si — reseta assim que aparece um número de novo.
            let index = chapter.realIndex;
            if (index !== null && chapter.part !== null) {
                const maxPart = maiorParteByChapter.get(partKey(chapter)) ?? chapter.part;
                const divisor = maxPart < 10 ? 10 : maxPart < 100 ? 100 : 1000;
                index = chapter.realIndex + chapter.part / divisor;
            }
            if (index === null) {
                const streak = nonNumericStreakByVolume.get(key) + 1;
                nonNumericStreakByVolume.set(key, streak);
                index = lastNumericIndexByVolume.get(key) + streak * 0.00001;
            } else {
                nonNumericStreakByVolume.set(key, 0);
                lastNumericIndexByVolume.set(key, index);
            }

            volume.chapters.push({
                capitulo: chapter.capitulo,
                name: chapter.name,
                url: chapter.url,
                index,
                volume: chapter.volumeLabel,
                part: chapter.part,
            });
        });

        // Rótulo repetido no site (dois capítulos com o mesmo "Cap. N"): o número certo está na URL.
        volumes.forEach(volume => this.resolveRepeatedIndexes(volume.chapters));
        // Rótulo de volume -> número ("01 | Ano 2", "14++", "Extra" não são lidos pelo Number()).
        this.assignVolumeNumbers(volumes);

        volumes.forEach(volume => volume.chapters.sort((a, b) => a.index - b.index));

        return { volumes, orderedChapterUrls: rawChapters.map(c => c.url) };
    }

    // Número do capítulo que a URL carrega ("...-capitulo-1740-2" -> 1740.002, "...-capitulo-14-1-2" ->
    // 14.001002, "...-capitulo-2-a" -> 2.001, "...-special-67" -> 67), na mesma escala do parseVersionNumber.
    slugNumber(url) {
        const slug = this.extractSlug(url || '') || '';
        const m = /capitulo-(\d+(?:-\d+)*)(?:-([a-z]))?$/i.exec(slug) || /-(\d+)()$/.exec(slug);
        if (!m) return null;
        return this.parseVersionNumber(m[1].replace(/-/g, '.') + (m[2] || ''));
    }

    // Dois capítulos do MESMO volume com o mesmo índice (rótulo repetido: cap. 12 e 13 saem "Cap. 12";
    // "capitulo-1740" e "capitulo-1740-2"). Só mexe em quem colide. Quem tem o número da URL igual ao
    // índice fica; os outros usam o número da URL se for livre e próximo (< 4 de distância, descarta
    // URL com typo como "-67" no lugar de "-87"); sem isso entram como base + k/1000 (mesmo epsilon do
    // repair-collapsed). Não depende de rede nem da ordem das chaves.
    resolveRepeatedIndexes(chapters) {
        const groups = new Map();
        for (const c of chapters) {
            if (!groups.has(c.index)) groups.set(c.index, []);
            groups.get(c.index).push(c);
        }
        const used = new Set(chapters.map(c => c.index));
        for (const [base, group] of groups) {
            if (group.length < 2) continue;
            const keeper = group.find(c => this.slugNumber(c.url) === base);
            const pending = [];
            for (const c of group) {
                if (c === keeper) continue;
                const d = this.slugNumber(c.url);
                if (d !== null && d !== base && Math.abs(d - base) < 4 && !used.has(d)) {
                    c.index = d;
                    used.add(d);
                } else {
                    pending.push(c);
                }
            }
            if (!keeper && pending.length) pending.shift(); // ninguém acertou a base: o primeiro da lista fica nela
            let k = 1;
            for (const c of pending) {
                let v;
                do { v = Number((base + k / 1000).toFixed(9)); k++; } while (used.has(v));
                c.index = v;
                used.add(v);
            }
        }
    }

    // Rótulo de volume do site -> número. null = nome sem número ("Extra", "Side Story 1", "Bonus").
    //   "3" / "04.5"          -> 3 / 4.5
    //   "01 | Ano 2"          -> 101 (Ano 1 mantém o número do volume; cada ano seguinte soma 100)
    //   "14+" / "14++"        -> 14.01 / 14.02
    volumeNumberFromLabel(label) {
        if (label === null || label === undefined) return 0;
        const t = String(label).trim();
        let m;
        if ((m = /^(\d+(?:\.\d+)?)$/.exec(t))) return Number(m[1]);
        if ((m = /^(\d+(?:\.\d+)?)\s*\|\s*ano\s*(\d+)$/i.exec(t))) return Number((Number(m[1]) + (Number(m[2]) - 1) * 100).toFixed(4));
        if ((m = /^(\d+(?:\.\d+)?)(\++)$/.exec(t))) return Number((Number(m[1]) + 0.01 * m[2].length).toFixed(4));
        return null;
    }

    // Volume com nome (sem número) quando precisa de número próprio: Extra 1000+N, Side Story 2000+N,
    // Bonus 3000+N, Especial 4000+N; qualquer outro nome 9000 + hash estável do texto.
    namedVolumeCode(label) {
        const t = String(label).trim();
        const bases = [[/^extra/i, 1000], [/^side\s*story/i, 2000], [/^b[oô]nus/i, 3000], [/^special|^especial/i, 4000]];
        for (const [re, base] of bases) {
            if (!re.test(t)) continue;
            const n = /(\d+(?:\.\d+)?)\s*$/.exec(t);
            return base + (n ? Number(n[1]) : 0);
        }
        let h = 0;
        for (const ch of t) h = (h * 31 + ch.codePointAt(0)) % 900;
        return 9000 + h;
    }

    // Preenche chapter.volume (número) em todos os capítulos. Volume com nome continua 0 (como sempre
    // foi) a menos que o espaço do volume 0 da obra tenha colisão de índice (extras repetindo o
    // "Cap. 1" do texto principal, "Extra 1" e "Extra 2" lado a lado): aí TODOS os volumes com nome
    // da obra ganham o código de namedVolumeCode. Obras sem colisão não mudam.
    assignVolumeNumbers(volumes) {
        const named = [];
        const zeroSpace = [];
        for (const volume of volumes) {
            const label = volume.chapters.length ? volume.chapters[0].volume : null;
            const num = this.volumeNumberFromLabel(label);
            volume.number = num;
            if (num === null) { named.push(volume); zeroSpace.push(...volume.chapters); }
            else if (num === 0) zeroSpace.push(...volume.chapters);
        }
        let collide = false;
        const seen = new Set();
        for (const c of zeroSpace) {
            if (seen.has(c.index)) { collide = true; break; }
            seen.add(c.index);
        }
        for (const volume of named) {
            volume.number = collide ? this.namedVolumeCode(volume.chapters[0].volume) : 0;
        }
        for (const volume of volumes) {
            for (const c of volume.chapters) c.volume = c.volume === null ? null : volume.number;
        }
    }

    // Ponteiro leve (sem conteúdo) de onde cada capítulo está na REST API, calculado
    // pela posição real dele na obra — não pelo número no slug, que pode resetar por
    // volume (Vol.1 Cap.1..50, Vol.2 Cap.1..30...) e não bateria com a página certa.
    async cacheChapterPositions(orderedChapterUrls) {
        // O slug da categoria no WP nem sempre bate com o slug da obra na URL — o site
        // já foi visto sufixando a categoria com uma data ao recriá-la (ex: obra
        // "supreme-magus", categoria "supreme-magus-20260913"), o que fazia a busca por
        // slug nunca achar nada e todo capítulo cair no fallback unitário (sempre MISS,
        // nunca pré-aquecia os 100 vizinhos). Descobrir a categoria pelo ID real do
        // primeiro capítulo é imune a isso: o ID de uma taxonomia não muda quando só o
        // slug é renomeado.
        const firstChapterSlug = this.extractSlug(orderedChapterUrls[0]);
        const { data: posts } = await axiosInstance.get(`${this.wpApiUrl}/posts`, {
            params: { slug: firstChapterSlug }
        });

        const categoryId = posts[0]?.categories?.[0];
        if (!categoryId) return;

        orderedChapterUrls.forEach((url, index) => {
            const page = Math.ceil((index + 1) / 100);
            cache.set(cacheKeys.chapterPosition(this.name, url), { categoryId, page }, cacheTTL.chapters);
        });
    }

    parseTitle($) {
        const titleElement = $('.entry-title');
        if (titleElement.length) {
            return titleElement.text().trim();
        }
        return null;
    }

    parseCover($) {
        const coverElement = $('.bigcontent .thumb img, .thumbook img, meta[property="og:image"]');
        if (coverElement.length > 0) {
            const cover = coverElement.first();
            return cover.attr('data-src') || cover.attr('src') || cover.attr('content');
        }
        return null;
    }

    parseAuthors($) {
        const meta = {};
        $('.ninfo .info-content .spe span').each((index, element) => {
            const txt = $(element).text().replace(/\s+/g, ' ').trim();
            const [key, ...rest] = txt.split(':');
            if (rest.length) {
                meta[key.trim()] = rest.join(':').trim();
            }
        });

        const authorField = meta['Autor'] || meta['Author'] || '';
        return authorField ? authorField.split(',').map(a => a.trim()).filter(Boolean) : [];
    }

// Limpeza compartilhada entre o pré-aquecimento (fetchVolumesFromApi) e a busca
    // avulsa (downloadChapterBody) — mesmo resultado nos dois caminhos.
    cleanChapterHtml(rawHtml) {
        const $ = cheerio.load(rawHtml);

        $('img').each(function () {
            const src = $(this).attr('src');
            const alt = $(this).attr('alt') || '';

            for (let attribute of this.attributes) {
                $(this).removeAttr(attribute.name);
            }

            $(this).attr('src', src);
            $(this).attr('alt', alt);
            $(this).addClass('mx-auto');
        });

        $('.epcontent.entry-content div.kln, .epcontent.entry-content div.klnmid').remove();
        $('p').removeAttr('style').removeAttr('data-mce-style');

        return $('body').html().replace(/"/g, "'").replace(/\n/g, '');
    }

    async downloadChapterBody(url, processImage = false) {
        const fullUrl = this.getFullUrl(url);

        if (!processImage) {
            const cached = cache.get(cacheKeys.chapterContent(this.name, fullUrl, false));
            if (cached) return cached;
        }

        // Sabemos (via readNovelInfo) em qual página da REST API esse capítulo cai —
        // busca a página inteira (100 capítulos + conteúdo), cacheia todos de uma vez
        // (os vizinhos, prováveis próximas leituras, ficam prontos também).
        const position = cache.get(cacheKeys.chapterPosition(this.name, fullUrl));
        if (position) {
            const result = await this.fetchAndCacheChapterPage(position.categoryId, position.page, fullUrl);
            if (result) {
                return processImage ? this.finalizeChapterBody(result.content) : result;
            }
        }

        // Fallback: busca exata por slug (sempre certo, só não aproveita vizinhos).
        // Usado quando a obra nunca passou por readNovelInfo, ou quando a página
        // estimada não continha esse capítulo (numeração pode ter furos/exceções).
        const slug = this.extractSlug(fullUrl);
        const { data: posts } = await axiosInstance.get(`${this.wpApiUrl}/posts`, {
            params: { slug }
        });

        const post = posts[0];
        if (!post) {
            throw new Error(`Capítulo não encontrado para o slug "${slug}"`);
        }

        const content = this.cleanChapterHtml(post.content.rendered);
        cache.set(cacheKeys.chapterContent(this.name, fullUrl, false), { content }, cacheTTL.chapterContent);

        return processImage ? this.finalizeChapterBody(content) : { content };
    }

    // Busca uma página de 100 capítulos da REST API e cacheia o conteúdo de cada um
    // individualmente — devolve o resultado do capítulo alvo, ou null se ele não
    // estava nessa página (numeração irregular fez a estimativa errar).
    async fetchAndCacheChapterPage(categoryId, page, targetUrl) {
        const { data: posts } = await axiosInstance.get(`${this.wpApiUrl}/posts`, {
            params: { categories: categoryId, per_page: 100, page, orderby: 'date', order: 'asc' }
        });

        let targetResult = null;
        posts.forEach(post => {
            const result = { content: this.cleanChapterHtml(post.content.rendered) };
            cache.set(cacheKeys.chapterContent(this.name, post.link, false), result, cacheTTL.chapterContent);
            if (post.link === targetUrl) targetResult = result;
        });

        return targetResult;
    }

    async finalizeChapterBody(content) {
        const processContent = await this.processImagesInContent(content);
        return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
    }

    async getLatestReleases() {
        try {
            const { data } = await axiosInstance.get(`${this.baseUrl}/series/?status=&type=&order=update`);
            const $ = cheerio.load(data);
            const latestReleases = [];

            $('.listupd .maindet').each((index, element) => {
                const url = $(element).find('.mdthumb a').attr('href');
                const imageUrl = $(element).find('.mdthumb img').attr('src');
                const title = $(element).find('.mdinfo h2 a').text().trim();
                const chapter = $(element).find('.nchapter a').text().trim();

                if (url && title && chapter) {
                    latestReleases.push({
                        url,
                        title,
                        chapter,
                        imageUrl
                    });
                }
            });

            return latestReleases;
        } catch (error) {
            console.error('Error getting latest releases:', error.message);
            throw error;
        }
    }
}

module.exports = new CentraNovelProvider();
