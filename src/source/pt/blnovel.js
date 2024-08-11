const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('../BaseProvider');  // Assumindo que BaseProvider é uma classe base similar a Crawler no Python

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
            results.push({
                title: a.text().trim(),
                url: this.getFullUrl(a.attr('href')),
                info: `${latest} | Rating: ${votes}`
            });
        });

        return results;
    }

    async readNovelInfo(novelUrl) {
        this.novelUrl = novelUrl;
        console.debug("Visiting", this.novelUrl);
        const { data } = await axios.get(this.novelUrl);
        const $ = cheerio.load(data);

        const possibleTitle = $('.post-title h1');
        possibleTitle.find('span').remove();
        this.novelTitle = possibleTitle.text().trim();
        console.info("Novel title:", this.novelTitle);

        const possibleImage = $('.summary_image a img');
        this.novelCover = possibleImage.attr('src') ? this.getFullUrl(possibleImage.attr('src')) : '';
        console.info("Novel cover:", this.novelCover);

        this.novelAuthor = $('.author-content a[href*="novel-author"]')
            .map((i, el) => $(el).text().trim())
            .get()
            .join(' ');
        console.info("Novel author:", this.novelAuthor);

        const chapterListUrl = this.getFullUrl('ajax/chapters');
        const { data: chapterData } = await axios.post(chapterListUrl, null, { headers: { accept: '*/*' } });
        const chapterSoup = cheerio.load(chapterData);

        this.chapters = [];
        this.volumes = [];

        chapterSoup('.wp-manga-chapter a[href*="/novel"]').each((i, a) => {
            const title = $(a).text().replace(/^\d+\s*-\s*/, '').trim();
            const chapId = this.chapters.length + 1;
            const volId = 1 + Math.floor(this.chapters.length / 100);
            if (chapId % 100 === 1) {
                this.volumes.push({ id: volId });
            }
            this.chapters.push({
                id: chapId,
                volume: volId,
                title: title,
                url: this.getFullUrl($(a).attr('href')),
            });
        });
    }

    async downloadChapterBody(chapter) {
        const { data } = await axios.get(this.getFullUrl(chapter.url));
        const $ = cheerio.load(data);
        const contents = $('.text-left');
        return this.cleaner ? this.cleaner.extractContents(contents) : contents.html();
    }
}

module.exports = new BlNovelsProvider();
