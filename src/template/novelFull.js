const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/source/BaseProvider');

class NovelFull extends BaseProvider {
    is_template = true;

    async searchNovel(query) {
        try {
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl);
            const $ = cheerio.load(data);
            const searchResults = [];

            $('.list .list-novel .row h3[class*="title"] > a').each((index, element) => {
                const title = $(element).attr('title') || $(element).text().trim();
                const url = this.absoluteUrl($(element).attr('href'));
                searchResults.push({ title, url });
            });

            return searchResults;
        } catch (error) {
            console.error('Error searching novel:', error.message);
            throw error;
        }
    }

    async readNovelInfo(novelUrl) {
        try {
            const { data } = await axios.get(this.getFullUrl(novelUrl));
            const $ = cheerio.load(data);

            const title = this.parseTitle($);
            const coverUrl = this.parseCover($);
            const authors = this.parseAuthors($);
            const volumes = [];

            const nlIdTag = $('#rating[data-novel-id]');
            if (!nlIdTag.length) throw new Error('No novel_id found');

            const novelId = nlIdTag.attr('data-novel-id');
            const scriptTag = $('script').filter((i, el) => /ajaxChapterOptionUrl\s+=/.test($(el).html()));
            const chapterUrl = scriptTag.length 
                ? `${this.homeUrl}ajax-chapter-option?novelId=${novelId}` 
                : `${this.homeUrl}ajax/chapter-archive?novelId=${novelId}`;
            const chaptersData = await axios.get(chapterUrl);
            const chapters$ = cheerio.load(chaptersData.data);

            chapters$('ul.list-chapter > li > a[href], select > option[value]').each((index, element) => {
                const chapterData = this.parseChapterItem(chapters$, element, index);
                volumes.push(chapterData);
            });

            return {
                title,
                coverUrl,
                authors,
                volumes: volumes.length,
                data: volumes,
                chapters: volumes.reduce((sum, vol) => sum + vol.chapters.length, 0)
            };
        } catch (error) {
            console.error('Error reading novel info:', error.message);
            throw error;
        }
    }

    async downloadChapterBody(url, processImage = false) {
        try {
            const { data } = await axios.get(this.getFullUrl(url));
            const $ = cheerio.load(data);
            const chapterBody = $('#chr-content, #chapter-content').html();
            
            let processedContent = processImage ? await this.processImagesInContent(chapterBody) : chapterBody;
            return { content: processedContent.replace(/"/g, "'").replace(/\n/g, '') };
        } catch (error) {
            console.error('Error downloading chapter body:', error.message);
            throw error;
        }
    }

    parseTitle($) {
        const titleTag = $('h3.title');
        if (titleTag.length) {
            return titleTag.text().trim();
        }
        throw new Error('Title not found');
    }

    parseCover($) {
        const coverTag = $('.book img');
        if (coverTag.length) {
            return this.absoluteUrl(coverTag.attr('data-src') || coverTag.attr('src'));
        }
        throw new Error('Cover not found');
    }

    parseAuthors($) {
        const authors = [];
        $('.info a[href*="/a/"], a[href*="/au/"], a[href*="/authors/"], a[href*="/author/"]').each((index, element) => {
            authors.push($(element).text().trim());
        });
        return authors;
    }

    parseChapterItem($, element, id) {
        return {
            id,
            title: $(element).text().trim(),
            url: this.absoluteUrl($(element).attr('href') || $(element).val()),
        };
    }
}

module.exports = NovelFull;
