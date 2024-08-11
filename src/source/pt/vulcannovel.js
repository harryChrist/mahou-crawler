const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('../BaseProvider');  // Assumindo que BaseProvider é uma classe base similar a Crawler no Python

class BlNovelsProvider extends BaseProvider {
    constructor() {
        super('vulcannovel', 'https://vulcannovel.com.br/');
        this.searchUrl = `${this.baseUrl}?s=%s&jet_ajax_search_settings=%7B"include_terms_ids"%3A%5B"486"%5D%7D`;
    }

    async searchNovel(query) {
        try {
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl);
            const $ = cheerio.load(data);
            const novelDetails = [];

            $('.jet-listing-grid__item').each(function () {
                const novelUrl = $(this).find('a').attr('href');
                const imageUrl = $(this).find('img').attr('src');
                const title = $(this).find('h2.elementor-heading-title a').text().trim();
                const rating = $(this).find('.elementor-star-rating__wrapper .elementor-star-full').length;
                const chapter = $(this).find('.elementor-button-text').text().trim();
                const genre = [];

                $(this).find('.jet-listing-dynamic-terms__link').each(function () {
                    genre.push($(this).text().trim());
                });

                novelDetails.push({
                    url: novelUrl,
                    title,
                    chapter,
                    imageUrl,
                    rating: rating + "/5",
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
    
            // Inicializando volumes
            const volumes = [];
    
            // Selecionando todos os elementos <volume> dentro de <capitulos>
            $('capitulos volume').each((index, element) => {
                const volumeName = $(element).find('h5 .ttl').text().trim();
                const chapters = [];
    
                // Percorrendo todos os capítulos dentro deste volume
                $(element).find('.capsVolume .linha_indice').each((chapterIndex, chapterElement) => {
                    const chapterData = this.parseChapterItem($, chapterElement);
                    chapterData.volume = volumeName; // Associando capítulo ao volume
                    chapters.push(chapterData);
                });
    
                volumes.push({
                    name: volumeName,
                    slug: this.slugifyString(volumeName),
                    chapters
                });
            });
    
            // Caso existam capítulos fora dos volumes, eles podem ser processados aqui
            const noVolumeChapters = [];
            $('capitulos semvolume .linha_indice').each((index, element) => {
                const chapterData = this.parseChapterItem($, element);
                chapterData.volume = null; // Indica que não tem volume associado
                noVolumeChapters.push(chapterData);
            });
    
            // Se existirem capítulos sem volume, adicionar no início da lista de volumes
            if (noVolumeChapters.length > 0) {
                volumes.unshift({
                    name: "Capítulos",
                    slug: this.slugifyString("Capítulos"),
                    chapters: noVolumeChapters
                });
            }
    
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
        const chapterNum = $(element).find('a').text().trim();
        const chapterText  = $(element).find('a').text().trim();
        const chapterTitle = chapterText.replace(/(Cap\.|Chap\.|Capítulo|Capitulo)\s*\d+\s*-\s*/, '').trim();
    
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

        let chapterContent = $('#Conteudo_post').html();

        if (processImage) {
            let processContent = await this.processImagesInContent(chapterContent);
            return { content: processContent.replace(/"/g, "'").replace(/\n/g, '') };
        }
        return { content: chapterContent.replace(/"/g, "'").replace(/\n/g, '') };
    }
}

module.exports = new BlNovelsProvider();
