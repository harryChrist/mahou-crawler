const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');  // Assumindo que BaseProvider é uma classe base similar a Crawler no Python

class BlNovelsProvider extends BaseProvider {
    constructor() {
        super('illusia', 'https://illusia.com.br/');
        this.searchUrl = `${this.baseUrl}?s=%s&post_type=fcn_story&sentence=0&orderby=modified&order=desc&age_rating=Any&story_status=Any&miw=0&maw=0&genres=&fandoms=&characters=&tags=&warnings=&authors=&ex_genres=&ex_fandoms=&ex_characters=&ex_tags=&ex_warnings=&ex_authors=`;
    }

    initialize() {
        this.cleaner = {
            badCss: [
                "div.padSection",
                "div#padSection",
            ]
        };
    }

    async searchNovel(query) {
        query = query.toLowerCase().replace(" ", "+");
        const searchUrl = this.searchUrl.replace('%s', query);
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data);

        const results = [];
        $('#search-result-list .card ').each((i, tab) => {
            const a = $(tab).find('h3 a');
            const imageURL = $(tab).find('a img').attr('src');
            results.push({
                url: a.attr('href') ? this.getFullUrl(a.attr('href')) : '',
                title: a.text().trim(),
                imageURL: imageURL,
            });
        });

        console.log(results)

        return results;
    }

    async readNovelInfo(novelUrl) {
        try {
            this.novelUrl = novelUrl;
            console.debug("Visiting", this.novelUrl);
            const { data } = await axios.get(this.novelUrl);
            const $ = cheerio.load(data);

            const possibleTitle = $('.story__identity-title');
            const novelTitle = possibleTitle.text().trim();

            const possibleImage = $('.story__header .story__thumbnail a');
            const novelCover = possibleImage.attr('href') ? this.getFullUrl(possibleImage.attr('href')) : '';
            console.info("Novel cover:", novelCover);

            const novelAuthors = $('.author-name')
                .map((i, el) => $(el).text().trim())
                .get();
            console.info("Novel author(s):", novelAuthors);

            const volumes = [];
            $('.chapter-group').each((index, element) => {
                let titulo = $(element).find('button span').text().trim() || 'Volume 0';
                const chapters = []

                const volumeMatch = titulo.match(/(Volume\.|Vol\.|Volume|Volúme)\s*(\d+)/i);

                $(element).find('.chapter-group__list-item').each((index, element) => {
                    const chapterUrl = $(element).find('a').attr('href');
                    const chapterNum = $(element).find('a').text().trim();
                    const chapterTitle = $(element).find('a').text().trim();

                    const capMatch = chapterNum.match(/(Cap\.|Chap\.|Capítulo|Capitulo)\s*(\d+)/i);
                    const extraMatch = chapterNum.match(/(Extra) (\d+)/);

                    if (!chapterUrl) return;

                    let chapterData = {
                        capitulo: chapterNum,
                        name: chapterTitle.includes('–') || chapterTitle.includes('-')
                            ? chapterTitle.replace(/^[^–-]*[-–]\s*/, '').trim()
                            : '',

                        url: chapterUrl,
                        index: parseInt(capMatch ? capMatch[2] : extraMatch ? extraMatch[2] : '', 10),
                        volume: volumeMatch ? parseInt(volumeMatch[2], 10) : null
                    };
                    chapters.push(chapterData);
                })

                volumes.push({
                    name: titulo,
                    slug: this.slugifyString(titulo),
                    chapters: chapters
                });
            });

            $('.eplister.eplisterfull ul li').each((index, element) => {
                const chapterData = this.parseChapterItem($, element);
                const volumeIndex = chapterData.volume ? this.findVolumeIndex(volumes, chapterData.volume) : 0;

                if (volumeIndex >= 0) {
                    volumes[volumeIndex].chapters.push(chapterData);
                } else {
                    // Caso especial para capítulos que não pertencem a um volume específico
                    if (volumes.length === 0) {
                        volumes.push({
                            name: "Capítulos",
                            slug: this.slugifyString("Capítulos"),
                            chapters: [chapterData]
                        });
                    } else {
                        volumes[0].chapters.push(chapterData);
                    }
                }
            });


            const novelData = {
                title: novelTitle,
                coverUrl: novelCover,
                authors: novelAuthors,
                chapters: volumes.reduce((total, volume) => total + volume.chapters.length, 0),
                volumes: volumes.length,
                data: volumes,
            };

            return novelData;
        } catch (error) {
            console.error("Erro ao buscar o conteúdo:", error.message);
            throw error;
        }
    }

    async downloadChapterBody(url, processImage = false) {
        const response = await axios.get(this.getFullUrl(url));
        const html = response.data;
        const $ = cheerio.load(html);

        $('img').each(function () {
            const src = $(this).attr('src');
            const alt = $(this).attr('alt') || '';  // Use um valor padrão vazio se o atributo alt não estiver presente

            // Remova todos os atributos
            for (let attribute of this.attributes) {
                $(this).removeAttr(attribute.name);
            }

            // Adicione apenas os atributos src e alt
            $(this).attr('src', src);
            $(this).attr('alt', alt);

            // Adicione a classe do Tailwind para centralizar
            $(this).addClass('mx-auto');
        });

        // Remover elementos com classe "hidden"
        $('.hidden').remove();

        // Remover elementos cujo texto comece com "Cap" ou "Traduto"
        $('p').each(function () {
            const text = $(this).text().trim();
            if (text.startsWith('Capitulo') || text.startsWith('Capítulo') || text.startsWith('Cap.') || text.startsWith('Revisado') || text.startsWith('Traduto')) {
                $(this).remove();
            }
        });

        // Remover elementos indesejados
        $('.epcontent.entry-content div.kln, .epcontent.entry-content div.klnmid').remove();
        $('div.padSection#padSection').remove();  // Remover <div class="padSection" id="padSection">
        $('p').removeAttr('style').removeAttr('data-mce-style').removeAttr('data-p-id');

        let chapterContent = $('#chapter-content').html();

        console.log(chapterContent)

        if (processImage) {
            let processContent = await this.processImagesInContent(chapterContent);
            return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
        }
        return { content: chapterContent.replace(/"/g, "'").replace(/\n/g, '') };
    }

}

module.exports = new BlNovelsProvider();