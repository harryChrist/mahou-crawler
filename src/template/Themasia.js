const axios = require("axios");
const cheerio = require("cheerio");
const BaseProvider = require("@/template/BaseProvider");

class ThemasiaTemplate extends BaseProvider {
    is_template = true;

    initialize() {
        this.badTags = new Set(["h3"]);
        this.badCss = new Set(['a[href="javascript:void(0)"]']);
    }

    async searchNovel(query) {
        console.log(query)
        try {
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl);
            const $ = cheerio.load(data);
            const novelDetails = [];

            $('.listupd .bs').each(function () {
                const novelUrl = $(this).find('.bsx a').attr('href');
                const imageUrl = $(this).find('.bsx img').attr('src');
                const title = $(this).find('.bsx .bigor .tt').text().trim();
                const chapter = $(this).find('.bsx .bigor .adds .epxs').text().trim();
                const type = $(this).find('.bsx .limit .novelabel').text().trim();

                novelDetails.push({
                    url: novelUrl,
                    title,
                    chapter,
                    imageUrl,
                    type
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
    
            const title = this.parseTitle($);
            const coverUrl = this.parseCover($);
            const genres = this.parseGenres($);
    
            const volumes = [];
    
            $('.eplister ul li').each((index, element) => {
                const chapterData = this.parseChapterItem($, element);
                let volumeName = chapterData.volume ? `Volume ${chapterData.volume}` : "Capítulos";
                let volume = volumes.find(vol => vol.name === volumeName);
    
                if (!volume) {
                    volume = { name: volumeName, slug: this.slugifyString(volumeName), chapters: [] };
                    volumes.push(volume);
                }
    
                volume.chapters.push(chapterData);
            });
    
            return {
                title,
                coverUrl,
                genres,
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

    parseGenres($) {
        const genres = [];
        $('.mgen a[href*="/genres/"]').each((index, element) => {
            genres.push($(element).text().trim());
        });
        return genres;
    }

    parseChapterItem($, element) {
        const chapterUrl = $(element).find('a').attr('href');
        const chapterTitle = $(element).find('.chapternum').text().trim() || '';
        const chapterDate = $(element).find('.chapterdate').text().trim() || '';
    
        // Captura o número do volume e o título do capítulo
        const volumeMatch = chapterTitle.match(/Vol\.\s*(\d+)/i);
        const chapterMatch = chapterTitle.match(/Cap\.?\s*(\d+)/i);
    
        // Remove a parte do volume e capítulo do título para extrair o nome
        let name = chapterTitle.replace(/Vol\.\s*\d+\s*-\s*/i, '').trim();
        if (chapterMatch) {
            name = name.replace(/Cap\.?\s*\d+/i, '').trim();
        }
    
        return {
            capitulo: chapterTitle,
            name: name,
            url: chapterUrl,
            index: chapterMatch ? parseInt(chapterMatch[1], 10) : null,
            volume: volumeMatch ? parseInt(volumeMatch[1], 10) : null,
            date: chapterDate
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

        let chapterContent = $('.div_principal').html();
        if (!chapterContent) chapterContent = $('#readerarea').html();
        if (processImage) {
            let processContent = await this.processImagesInContent(chapterContent);
            return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
        }
        return { content: chapterContent.replace(/"/g, "'").replace(/\n/g, '') };
    }
}

module.exports = ThemasiaTemplate;