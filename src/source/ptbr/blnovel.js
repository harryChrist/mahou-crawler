const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');  // Assumindo que BaseProvider é uma classe base similar a Crawler no Python

class BlNovelsProvider extends BaseProvider {
    constructor() {
        super('blnovels', 'https://blnovels.net/');
        this.searchUrl = `${this.baseUrl}?s=%s&post_type=wp-manga`;
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
        $('.c-tabs-item__content').each((i, tab) => {
            const a = $(tab).find('.post-title h3 a');
            const latest = $(tab).find('.latest-chap .chapter a').text();
            const votes = $(tab).find('.rating .total_votes').text();
            const imageURL = $(tab).find('.tab-thumb a img').attr('src');
            results.push({
                url: this.getFullUrl(a.attr('href')),
                title: a.text().trim(),
                imageURL: imageURL,
                chapter: latest,
                ranking: votes
            });
        });

        return results;
    }

    async readNovelInfo(novelUrl) {
        try {
            this.novelUrl = novelUrl;
            console.debug("Visiting", this.novelUrl);
            const { data } = await axios.get(this.novelUrl);
            const $ = cheerio.load(data);

            const possibleTitle = $('.post-title h1');
            possibleTitle.find('span').remove();
            const novelTitle = possibleTitle.text().trim();
            console.info("Novel title:", novelTitle);

            const possibleImage = $('.summary_image a img');
            const novelCover = possibleImage.attr('src') ? this.getFullUrl(possibleImage.attr('src')) : '';
            console.info("Novel cover:", novelCover);

            const novelAuthors = $('.author-content a[href*="autor"]')
                .map((i, el) => $(el).text().trim())
                .get();

            console.info("Novel author(s):", novelAuthors);

            const chapterListUrl = this.getFullUrl(this.novelUrl + 'ajax/chapters');
            const { data: chapterData } = await axios.post(chapterListUrl, null, {
                headers: {
                    'accept': '*/*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
                    'Referer': this.novelUrl, // Referer para indicar de onde a requisição está sendo feita
                    'X-Requested-With': 'XMLHttpRequest' // Indica que a requisição foi feita via AJAX
                }
            });
            const chapterSoup = cheerio.load(chapterData);

            let chapters = [];
            let volumes = [];

            // Caso 1: Não há volumes, apenas capítulos
            const noVolumes = chapterSoup('.no-volumn');
            if (noVolumes.length) {
                noVolumes.find('.wp-manga-chapter a').each((i, a) => {
                    chapters.push(this.processChapter(chapterSoup(a), 0));
                });
                volumes.push({ name: "Volume 0", slug: "volume-0", chapters })
            }

            // Caso 2: Há volumes e capítulos dentro de cada volume
            const withVolumes = chapterSoup('.volumns');
            if (withVolumes.length) {
                withVolumes.find('.parent').each((i, volumeElement) => {
                    const volumeName = chapterSoup(volumeElement).find('a').first().text().trim();
                    const volumeSlug = this.slugifyString(volumeName);
                    const volumeId = parseFloat(volumeName.match(/Volume (\d+(\.\d+)?)/)?.[1]) || null

                    // Processando capítulos dentro deste volume
                    let volumeChapters = [];
                    chapterSoup(volumeElement).find('.wp-manga-chapter a').each((j, a) => {
                        volumeChapters.push(this.processChapter(chapterSoup(a), volumeId));
                    });

                    volumes.push({
                        name: volumeName,
                        slug: volumeSlug,
                        chapters: volumeChapters
                    });
                });
            }

            // Reverter a ordem dos volumes e capítulos
            volumes.reverse();
            volumes.forEach(volume => {
                volume.chapters.reverse();
            });

            // Atribuir o `index` incremental a partir de 1 para cada capítulo em cada volume
            volumes.forEach(volume => {
                volume.chapters.forEach((chapter, index) => {
                    chapter.index = index + 1;
                    chapter.capitulo = `Vol. ${chapter.volume} Cap. ${chapter.index}`;
                });
            });

            // Contabilizando volumes
            const totalVolumes = volumes.length > 0 ? volumes.length : 1;  // Se não houver volumes, considerar 1

            // Estruturando o objeto final
            const novelData = {
                title: novelTitle,
                coverUrl: novelCover,
                authors: novelAuthors,
                volumes: totalVolumes,
                data: volumes
            };

            return novelData
        } catch (error) {
            console.error("Erro ao buscar o conteúdo:", error.message);
            throw error;
        }
    }

    processChapter(chapterElement, volumeId) {
        const title = chapterElement.text().trim();
        let index = 0;
        const cleanedTitle = title.replace(/Cap[íi]tulo\s*\d+\s*[-:]\s*/i, '').trim();
        const finalTitle = cleanedTitle === title ? '' : cleanedTitle;
        const capitulo = `Vol. ${volumeId} Cap. ${index}`;
    
        return {
            capitulo: capitulo,
            name: finalTitle,
            url: this.getFullUrl(chapterElement.attr('href')),
            index: index,
            volume: volumeId
        };
    }
    
    

    async downloadChapterBody(chapter) {
        const { data } = await axios.get(this.getFullUrl(chapter.url));
        const $ = cheerio.load(data);
        const contents = $('.text-left');
        return this.cleaner ? this.cleaner.extractContents(contents) : contents.html();
    }
}

module.exports = new BlNovelsProvider();