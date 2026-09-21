const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

class BlNovelProvider extends BaseProvider {
    constructor() {
        // O domínio antigo (blnovel.com, no singular) saiu do ar — o site vive em
        // blnovels.com. É um WordPress com tema Madara/WP-Manga, o mesmo padrão de
        // vários sites de novel.
        super('blnovel', 'https://blnovels.com', 'novel');
    }

    // Busca nativa do Madara: ?s=termo&post_type=wp-manga. A URL antiga
    // (/novels?titulo=) não existe nesse tema.
    searchUrlFor(query) {
        return `${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
    }

    // Capa pode vir em data-src quando o tema está com carregamento preguiçoso ligado.
    parseImage($el) {
        return $el.attr('data-src') || $el.attr('src') || null;
    }

    // "Capítulo 80 Falta de Romantismo" -> rótulo "Capítulo 80" + nome "Falta de
    // Romantismo". O site não usa separador entre o número e o título (nem ":" nem
    // "-"), por isso o corte é pelo fim do número. Sem número (ex: "Introdução"),
    // o texto inteiro vira os dois campos.
    splitChapterTitle(text) {
        const match = text.match(/^(cap[íi]tulo\s*[\d.]+)\s*[-:–—]?\s*(.*)$/i);
        if (!match) return { label: text, name: text, number: null };

        const name = match[2].trim();
        const number = parseFloat(match[1].replace(/[^\d.]/g, ''));

        return {
            label: match[1].trim(),
            name: name || match[1].trim(),
            number: Number.isNaN(number) ? null : number,
        };
    }

    async searchNovel(query) {
        try {
            const { data } = await axios.get(this.searchUrlFor(query), { headers: HEADERS });
            const $ = cheerio.load(data);

            const results = [];
            $('.c-tabs-item__content').each((index, element) => {
                const link = $(element).find('.post-title a').first();
                const url = link.attr('href');
                if (!url) return;

                results.push({
                    url: this.getFullUrl(url),
                    title: link.text().trim(),
                    // Nem todo resultado traz último capítulo e nota — vira null quando falta.
                    chapter: $(element).find('.latest-chap .chapter a').first().text().trim() || null,
                    imageUrl: this.parseImage($(element).find('.tab-thumb a img').first()),
                    rating: $(element).find('.rating .total_votes').first().text().trim() || null,
                    genre: $(element).find('.post-content_item .summary-content a').map((i, a) => $(a).text().trim()).get(),
                });
            });

            return results;
        } catch (error) {
            console.error('Erro ao buscar o conteúdo:', error.message);
            throw error;
        }
    }

    async readNovelInfo(novelUrl) {
        try {
            const fullUrl = this.getFullUrl(novelUrl);
            const { data } = await axios.get(fullUrl, { headers: HEADERS });
            const $ = cheerio.load(data);

            const titleElement = $('.post-title h1').clone();
            titleElement.find('span').remove(); // o tema pendura selos ("HOT", "NEW") dentro do h1
            const title = titleElement.text().trim();

            const meta = this.parseMetaBlocks($);
            const alternatives = (meta['Alternativo'] || '')
                .split(/[/|,]/)
                .map(t => t.trim())
                .filter(Boolean);

            const { volumes, chapters } = this.parseChapters($);

            return {
                title,
                coverUrl: this.parseImage($('.summary_image a img').first()),
                // O site não publica autor: o .author-content do tema vem sempre vazio.
                // Melhor devolver vazio do que inventar um valor.
                author: [],
                titles: alternatives.length ? alternatives : [title],
                genres: $('.genres-content a').map((i, el) => $(el).text().trim()).get(),
                synopsis: $('.summary__content').text().trim(),
                volumes: volumes.length,
                data: volumes,
                chapters,
            };
        } catch (error) {
            console.error('Erro ao buscar o conteúdo:', error.message);
            throw error;
        }
    }

    // Blocos "rótulo = valor" da ficha (Alternativo, Gênero(s), Tipo, Status...).
    parseMetaBlocks($) {
        const meta = {};
        $('.post-content_item').each((index, element) => {
            const key = $(element).find('.summary-heading').text().replace(/\s+/g, ' ').trim();
            const value = $(element).find('.summary-content').text().replace(/\s+/g, ' ').trim();
            if (key) meta[key] = value;
        });
        return meta;
    }

    // A lista inteira já vem no HTML da página da obra — conferido em obras de 1 a 687
    // capítulos. O POST em /ajax/chapters que o Madara expõe não é necessário.
    // `.wp-manga-chapter` continua pegando tudo mesmo se o site passar a agrupar por
    // volume, porque a classe fica no <li> nos dois layouts.
    parseChapters($) {
        const raw = [];
        $('.wp-manga-chapter').each((index, element) => {
            const link = $(element).find('a').first();
            const url = link.attr('href');
            if (!url) return;

            const text = link.text().replace(/\s+/g, ' ').trim();
            raw.push({ url: this.getFullUrl(url), ...this.splitChapterTitle(text) });
        });

        // O site lista do mais novo pro mais antigo — inverte pra ordem de leitura.
        raw.reverse();

        // Index é o número real do capítulo, não a posição na lista: assim um capítulo
        // que falta e for publicado depois entra no lugar dele, sem deslocar os outros.
        // Sem número (Prólogo, Introdução, Extra), ancora logo depois do último numerado,
        // com um contador de sequência pra vários seguidos não colidirem entre si.
        let lastNumeric = 0;
        let streak = 0;
        const usados = new Set();

        const chapters = raw.map(chapter => {
            let index = chapter.number;
            if (index === null) {
                streak += 1;
                index = lastNumeric + streak * 0.00001;
            } else {
                streak = 0;
                lastNumeric = index;
            }

            // O próprio site repete número às vezes (visto na prática: dois "Capítulo 431"
            // — um deles reenvio — e dois "Capítulo 432" com textos diferentes, na mesma
            // obra). Empurra o repetido um passo mínimo pra frente: ele fica logo depois
            // do original, na ordem certa, e o index continua único.
            while (usados.has(index)) {
                index = Number((index + 0.00001).toFixed(5));
            }
            usados.add(index);

            return {
                capitulo: chapter.label,
                name: chapter.name,
                url: chapter.url,
                index,
                volume: null,
            };
        });

        chapters.sort((a, b) => a.index - b.index);

        const volumes = chapters.length
            ? [{ name: 'Capítulos', slug: this.slugifyString('Capítulos'), chapters }]
            : [];

        return { volumes, chapters: chapters.length };
    }

    async downloadChapterBody(url, processImage = false) {
        const fullUrl = this.getFullUrl(url);
        const { data } = await axios.get(fullUrl, { headers: HEADERS });
        const $ = cheerio.load(data);

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

        $('div.padSection, div#padSection').remove();
        $('p').removeAttr('style').removeAttr('data-mce-style').removeAttr('data-p-id');

        const chapterContent = $('.text-left').html();
        if (!chapterContent) {
            throw new Error(`Conteúdo do capítulo não encontrado em "${fullUrl}"`);
        }

        if (processImage) {
            const processContent = await this.processImagesInContent(chapterContent);
            return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
        }
        return { content: chapterContent.replace(/"/g, "'").replace(/\n/g, '') };
    }

    async getLatestReleases() {
        try {
            const { data } = await axios.get(this.baseUrl, { headers: HEADERS });
            const $ = cheerio.load(data);

            const latestReleases = [];
            $('.page-item-detail').each((index, element) => {
                const link = $(element).find('.post-title a').first();
                const url = link.attr('href');
                const title = link.text().trim();
                if (!url || !title) return;

                latestReleases.push({
                    url: this.getFullUrl(url),
                    title,
                    chapter: $(element).find('.chapter-item .chapter a, .list-chapter .chapter a').first().text().trim() || null,
                    imageUrl: this.parseImage($(element).find('img').first()),
                });
            });

            return latestReleases;
        } catch (error) {
            console.error('Error getting latest releases:', error.message);
            throw error;
        }
    }
}

module.exports = new BlNovelProvider();
