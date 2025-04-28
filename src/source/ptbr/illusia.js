const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');  // Assumindo que BaseProvider é uma classe base similar a Crawler no Python

class IllusiaProvider extends BaseProvider {
    constructor() {
        super('illusia', 'https://illusia.com.br', 'novel');
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

            const novelAuthors = [];
            $('.author').each((i, el) => {
                console.log(i)
                const authorName = $(el).text().trim();
                if (authorName && !novelAuthors.includes(authorName)) {
                    novelAuthors.push(authorName);
                }
            });

            const synopsis = $('.story__summary').text().trim();

            //generos tag-group
            const genres = [];
            $('.tag-group a').each((i, el) => {
                const genre = $(el).text().trim();
                if (genre && !genres.includes(genre)) {
                    genres.push(genre);
                }
            });

            const volumes = [];
            $('.chapter-group').each((index, element) => {
                let titulo = $(element).find('button span').text().trim() || 'Volume 0';
                const chapters = []

                // Extract volume number from title if it exists
                const volumeMatch = titulo.match(/(Volume\.|Vol\.|Volume|Volúme|Parte)\s*(\d+)/i);
                
                // If there's only one chapter group, keep volume as 0, otherwise number sequentially from 1
                const totalGroups = $('.chapter-group').length;
                const volumeNumber = totalGroups === 1 ? 0 : (index + 1);

                $(element).find('.chapter-group__list-item').each((index, element) => {
                    const chapterUrl = $(element).find('a').attr('href');
                    const chapterNum = $(element).find('a').text().trim();
                    const chapterTitle = $(element).find('a').text().trim();

                    const capMatch = chapterNum.match(/(Cap\.|Chap\.|Capítulo|Capitulo)\s*(\d+)/i);
                    const extraMatch = chapterNum.match(/(Extra) (\d+)/);

                    if (!chapterUrl) return;

                    let chapterData = {
                        capitulo: chapterNum,
                        name: chapterTitle.includes(':')
                            ? chapterTitle.replace(/^[^:]*:\s*/, '').trim()
                            : chapterTitle.includes('-')
                            ? chapterTitle.replace(/^[^-]*-\s*/, '').trim()
                            : chapterTitle,
                        url: chapterUrl,
                        index: parseInt(capMatch ? capMatch[2] : extraMatch ? extraMatch[2] : '', 10),
                        volume: volumeNumber
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
                titles: [novelTitle],
                author: novelAuthors,
                genres: genres,
                synopsis: synopsis,
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

    // title, url, image, chapter
    async getLatestReleases() {
        try {
            // Make concurrent requests for both pages
            const [page1Response, page2Response, page3Response, page4Response] = await Promise.all([
                axios.get(this.baseUrl + '/?s=&post_type=fcn_story&sentence=0&orderby=modified&order=desc&age_rating=Any&story_status=Any&miw=0&maw=0&ex_fandoms=1831'),
                axios.get(this.baseUrl + '/page/2/?s=&post_type=fcn_story&sentence=0&orderby=modified&order=desc&age_rating=Any&story_status=Any&miw=0&maw=0&ex_fandoms=1831'),
                axios.get(this.baseUrl + '/page/3/?s=&post_type=fcn_story&sentence=0&orderby=modified&order=desc&age_rating=Any&story_status=Any&miw=0&maw=0&ex_fandoms=1831'),
                axios.get(this.baseUrl + '/page/4/?s=&post_type=fcn_story&sentence=0&orderby=modified&order=desc&age_rating=Any&story_status=Any&miw=0&maw=0&ex_fandoms=1831'),
            ]);

            const latestReleases = [];

            // Process both pages
            [page1Response.data, page2Response.data, page3Response.data, page4Response.data].forEach(data => {
                const $ = cheerio.load(data);

                $('#search-result-list .card').each((index, element) => {
                    const title = $(element).find('.card__title a').text().trim();
                    const url = $(element).find('.card__title a').attr('href');
                    const imageUrl = $(element).find('.card__image img').attr('src');
                    const chapter = $(element).find('.card__link-list-item:last-child .card__link-list-link').text().trim();

                    if (url && title && imageUrl && chapter) {
                        latestReleases.push({
                            title: title,
                            url: url,
                            imageUrl: imageUrl,
                            chapter: chapter
                        });
                    }
                });
            });

            return latestReleases;
        } catch (error) {
            console.error("Erro ao buscar os releases mais recentes:", error.message);
            throw error;
        }
    }

}

module.exports = new IllusiaProvider();