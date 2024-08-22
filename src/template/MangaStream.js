const axios = require("axios");
const cheerio = require("cheerio");
const BaseProvider = require("@/template/BaseProvider");

class MangaStream extends BaseProvider {
    is_template = true;
    async searchNovel(query) {
        try {
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl);
            const $ = cheerio.load(data);
            const novelDetails = [];

            $('.listupd .maindet').each(function () {
                const novelUrl = $(this).find('.mdthumb a').attr('href');
                const imageUrl = $(this).find('.mdthumb img').attr('src');
                const title = $(this).find('.mdinfo h2').text().trim();
                const rating = $(this).find('.mdminf').text().trim();
                const chapter = $(this).find('.nchapter').text().trim();
                const genre = [];

                $(this).find('.mdgenre a').each(function () {
                    genre.push($(this).text().trim());
                });

                novelDetails.push({
                    url: novelUrl,
                    title,
                    chapter,
                    imageUrl,
                    rating,
                    genre,
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
    
            // Extraindo volumes e capítulos
            const volumes = [];
    
            $('.bixbox.bxcl.epcheck .ts-chl-collapsible').each((index, element) => {
                volumes.push({
                    name: $(element).text().trim(),
                    slug: this.slugifyString($(element).text().trim()),
                    chapters: []
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
        const titleElement = $('h1.entry-title');
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
        $('.spe a[href*="/writer/"]').each((index, element) => {
            authors.push($(element).text().trim());
        });
        return authors;
    }
    
    parseChapterItem($, element) {
        const chapterUrl = $(element).find('a').attr('href');
        const chapterNum = $(element).find('.epl-num').text().trim();
        const chapterTitle = $(element).find('.epl-title').text().trim();
    
        const capMatch = chapterNum.match(/(Cap\.|Chap\.|Capítulo|Capitulo)\s*(\d+)/i);
        const extraMatch = chapterNum.match(/(Extra) (\d+)/);
    
        return {
            capitulo: chapterNum,
            name: chapterTitle.replace(/^\d+\s*-\s*/, '').trim(),
            url: chapterUrl,
            index: parseInt(capMatch ? capMatch[2] : extraMatch ? extraMatch[2] : '', 10),
            volume: parseFloat(chapterNum.match(/Vol\. (\d+(\.\d+)?)/)?.[1]) || null
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
        $('.epcontent.entry-content div.kln, .epcontent.entry-content div.klnmid').remove();
        $('p').removeAttr('style').removeAttr('data-mce-style');

        let chapterContent = $('#readernovel, #readerarea, .entry-content').html();

        if (processImage) {
            let processContent = await this.processImagesInContent(chapterContent);
            return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
        }
        return { content: chapterContent.replace(/"/g, "'").replace(/\n/g, '') };
    }
}

module.exports = MangaStream;