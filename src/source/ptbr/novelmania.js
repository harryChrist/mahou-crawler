const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');  // Assumindo que BaseProvider é uma classe base similar a Crawler no Python

class NovelManiaProvider extends BaseProvider {
    constructor() {
        super('novelmania', 'https://novelmania.com.br', 'novel');
        this.searchUrl = `${this.baseUrl}/novels?titulo=%s`;
    }

    async searchNovel(query) {
        try {
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl);
            const $ = cheerio.load(data);
            const novelDetails = [];

            $('div.top-novels').each((index, elemento) => {
                const url = this.baseUrl + $(elemento).find('a.novel-title').attr('href');
                const imageUrl = $(elemento).find('img.card-image').attr('src');
                const title = $(elemento).find('a.novel-title h5').text().trim();
                const chapter = $(this).find('span.text-muted-foreground').text().trim();
                const synopsis = $(elemento).find('div.description').text().trim();

                novelDetails.push({
                    url,
                    title,
                    chapter,
                    imageUrl,
                    synopsis
                });
            });

            return novelDetails;
        } catch (error) {
            console.error("Erro ao buscar o conteúdo:", error.message);
            throw error;
        }
    }

    async readNovelInfo(novelUrl) {
        try {
            const { data } = await axios.get(this.getFullUrl(novelUrl));
            const $ = cheerio.load(data);

            // Extraindo Informações extras
            const title = this.parseTitle($);
            const coverUrl = this.parseCover($);
            const authors = this.parseAuthors($);

            // Inicializando volumes
            const volumes = [];

            $('.card-header').each((index, element) => {
                volumes.push({
                    name: $(element).text().trim(),
                    slug: this.slugifyString($(element).text().trim()),
                    chapters: []
                });
            });

            // Selecionando todos os elementos <volume> dentro de <capitulos>
            // Selecionando todos os elementos <div.card-header> que representam volumes
            $(`ol.list-inline li`).each((index, element) => {
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

                /*const link = $(elemento).parent().attr('href');
                const chapterTitle = $(elemento).siblings('strong').text();
                const data = $(elemento).siblings('small').text();
                const volumeName = $(elemento).siblings('span').text();
                const volumeNumberMatch = volumeName.match(/\d+/);
                const volumeNumber = volumeNumberMatch ? parseInt(volumeNumberMatch[0], 10) : null;
                const chapterMatch = chapterTitle.match(/\d+/);
                const chapterNumber = chapterMatch ? parseInt(chapterMatch[0], 10) : null;

                const novoCapitulo = {
                    index: chapterNumber,
                    volume: volumeNumber,
                    name: chapterTitle,
                    slug: this.slugifyString(title),
                    createdAt: data,
                    url: link, index: 0
                };

                const volumeExistente = volumes.find((item) => item.volume === volumeNumber);

                if (volumeExistente) {
                    volumeExistente.chapters.push(novoCapitulo);
                } else {
                    const novoVolume = { volume: volumeNumber, name: volumeName, slug: this.slugifyString(volumeName), chapters: [novoCapitulo] };
                    volumes.push(novoVolume);
                }*/
            });

            // Ordenando volumes e capítulos (se necessário)
            this.sortVolumesAndChapters(volumes);

            return {
                title,
                coverUrl,
                authors,
                volumes: volumes.length,
                data: volumes,
                chapters: volumes.reduce((sum, vol) => sum + vol.chapters.length, 0)
            };
        } catch (error) {
            console.error("Erro ao buscar os capítulos:", error.message);
            throw error;
        }
    }

    parseTitle($) {
        const titleElement = $('.novel-info h1');
        if (titleElement) {
            return titleElement.text().trim();
        }
        return null;
    }

    parseCover($) {
        const coverElement = $('.thumbook img, meta[property="og:image"], .sertothumb img');
        if (coverElement.length > 0) {
            const cover = coverElement.first();
            return cover.attr('data-src') || cover.attr('src') || cover.attr('content');
        }
        return null;
    }

    parseAuthors($) {
        const authors = [];
        $('.authors').each((index, element) => {
            authors.push($(element).text().trim());
        });
        return authors;
    }

    parseChapterItem($, element) {
        const chapterUrl = $(element).find('a').attr('href');
        const chapterNum = $(element).find('strong').text().trim();
        const chapterText = $(element).find('strong').text().trim();
        const chapterTitle = chapterText.replace(/(Cap\.|Chap\.|Capítulo|Capitulo)\s*\d+\s*-\s*/, '').trim();

        const volumeName = $(element).find('span').text();
        const volumeNumberMatch = volumeName.match(/\d+/);
        const volumeNumber = volumeNumberMatch ? parseInt(volumeNumberMatch[0], 10) : null;

        const capMatch = chapterNum.match(/(Cap\.|Chap\.|Capítulo|Capitulo)\s*(\d+)/i);
        const extraMatch = chapterNum.match(/(Extra) (\d+)/);

        return {
            name: chapterTitle.replace(/^\d+\s*-\s*/, '').trim(),
            url: this.baseUrl + chapterUrl,
            index: parseInt(capMatch ? capMatch[2] : extraMatch ? extraMatch[2] : '', 10),
            volume: volumeNumber
        };
    }

    findVolumeIndex(volumes, volumeNumber) {
        return volumes.findIndex(vol => parseFloat(vol.name.replace('Volume', '').trim()) === volumeNumber);
    }

    sortVolumesAndChapters(volumes) {
        volumes.forEach(volume => {
            volume.chapters.sort((a, b) => a.index - b.index);
        });

        volumes.sort((a, b) => {
            const numA = parseInt(a.name.replace(/[^0-9]/g, ''), 10);
            const numB = parseInt(b.name.replace(/[^0-9]/g, ''), 10);

            return isNaN(numA) || isNaN(numB) ? a.name.localeCompare(b.name) : numA - numB;
        });
    }

    async downloadChapterBody(url, processImage = false) {
        const response = await axios.get(this.getFullUrl(url));
        const html = response.data;
        const $ = cheerio.load(html);

        $('script, iframe, .adsbygoogle').remove();

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

        // Remover elementos indesejados
        //$('.epcontent.entry-content div.kln, .epcontent.entry-content div.klnmid').remove();
        $('p').removeAttr('style').removeAttr('data-mce-style');

        let chapterContent = $('#chapter-content').html();

        if (processImage) {
            let processContent = await this.processImagesInContent(chapterContent);
            return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
        }
        return { content: chapterContent.replace(/"/g, "'").replace(/\n/g, '') };
    }
}

module.exports = new NovelManiaProvider();
