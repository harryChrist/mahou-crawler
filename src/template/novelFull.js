const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');
const puppeteer = require('puppeteer');

class NovelFull extends BaseProvider {
    is_template = true;

    async searchNovel(query) {
        try {
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl);
            const $ = cheerio.load(data);
            const searchResults = [];

            $('.list-novel .row').each((index, element) => {
                const titleElement = $(element).find('.novel-title a');
                const title = titleElement.attr('title') || titleElement.text().trim();
                const url = titleElement.attr('href');
                const author = $(element).find('.author').text().trim().replace(' ', '');
                const cover = $(element).find('.cover').attr('src');
                const chapter = $(element).find('.chapter-title').text().trim();

                searchResults.push({
                    title,
                    url,
                    author,
                    cover,
                    chapter
                });
            });

            return searchResults;
        } catch (error) {
            console.error('Error searching novel:', error.message);
            throw error;
        }
    }

    async readNovelInfo(novelUrl) {
        try {
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                dumpio: false // Disable verbose Chrome logs
            });
            const page = await browser.newPage();

            // Navegar para a página
            await page.goto(this.getFullUrl(novelUrl) + '#tab-chapters-title', { waitUntil: 'networkidle0' });

            // Esperar o conteúdo carregar
            await page.waitForSelector('.panel-body .row', { timeout: 30000 });

            // Extrair o HTML
            const content = await page.content();
            await browser.close();

            const $ = cheerio.load(content);

            const title = $('h3.title').text().trim();
            const coverUrl = $('.book img').attr('src') || $('.book img').attr('data-src');
            const author = $('.info-meta li:contains("Author:") a').text().trim();
            const status = $('.info-meta li:contains("Status:") a').text().trim();
            const rating = $('span[itemprop="ratingValue"]').text().trim();
            const ratingCount = $('span[itemprop="reviewCount"]').text().trim();

            const genres = [];
            $('.info-meta li:contains("Genre:") a').each((index, element) => {
                genres.push($(element).text().trim());
            });

            const tags = [];
            $('.tag-container a').each((index, element) => {
                tags.push($(element).text().trim());
            });

            const chapters = [];
            let lastChapterNumber = 0;
            let specialChapterCount = 0;
            let glossaryCount = 0;
            let currentVolume = 0;
            let volumes = {};

            // Iterar sobre cada row no panel-body
            $('.panel-body .row').each((rowIndex, row) => {
                // Iterar sobre cada coluna na row
                $(row).find('.col-xs-12').each((colIndex, col) => {
                    // Iterar sobre cada capítulo na lista
                    $(col).find('.list-chapter li').each((index, element) => {
                        const chapterTitle = $(element).find('a').attr('title') || $(element).find('.chapter-title').text().trim();
                        const chapterUrl = $(element).find('a').attr('href');

                        // Padrões de regex para diferentes formatos
                        const volumePattern = /Vol\.?\s*(\d+)\s*[-–]\s*Ch\.?\s*(\d+)\s*[-–]\s*(.*)/i;
                        const chapterPattern = /Chapter\s*(\d+)\s*[-–]\s*(.*)/i;
                        const numberedPattern = /^(\d+)\s*[-–]\s*(.*)/;
                        const decimalPattern = /^(\d+\.\d+)\s*[-–]\s*(.*)/;
                        const glossaryPattern = /^(Glossary|Mini Wiki|Characters and Factions)/i;

                        let chapterNumber;
                        let chapterName = '';
                        let volume = 0;
                        let isSpecialChapter = false;
                        let isGlossary = false;

                        // Verificar se é um glossário
                        if (glossaryPattern.test(chapterTitle)) {
                            isGlossary = true;
                            glossaryCount++;
                            chapterNumber = glossaryCount / 100; // 0.01, 0.02, etc
                            chapterName = chapterTitle;
                        }
                        // Verificar se é um volume com capítulo
                        else if (volumePattern.test(chapterTitle)) {
                            const match = chapterTitle.match(volumePattern);
                            volume = parseInt(match[1]);
                            chapterNumber = parseInt(match[2]);
                            chapterName = match[3].trim();
                            currentVolume = volume;
                        }
                        // Verificar se é um capítulo numerado
                        else if (chapterPattern.test(chapterTitle)) {
                            const match = chapterTitle.match(chapterPattern);
                            chapterNumber = parseInt(match[1]);
                            chapterName = match[2].trim();
                            volume = currentVolume;
                        }
                        // Verificar se é um capítulo com número decimal
                        else if (decimalPattern.test(chapterTitle)) {
                            const match = chapterTitle.match(decimalPattern);
                            chapterNumber = parseFloat(match[1]);
                            chapterName = match[2].trim();
                            volume = Math.floor(chapterNumber);
                        }
                        // Verificar se é um capítulo apenas numerado
                        else if (numberedPattern.test(chapterTitle)) {
                            const match = chapterTitle.match(numberedPattern);
                            chapterNumber = parseInt(match[1]);
                            chapterName = match[2].trim();
                            volume = currentVolume;
                        }
                        // Verificar se é um capítulo especial (Prologue, Epilogue, etc)
                        else if (/^(Prologue|Epilogue|Illustrations)/i.test(chapterTitle)) {
                            isSpecialChapter = true;
                            specialChapterCount++;
                            chapterNumber = specialChapterCount / 10; // 0.1, 0.2, etc
                            chapterName = chapterTitle;
                        }
                        // Caso não se encaixe em nenhum padrão
                        else {
                            lastChapterNumber++;
                            chapterNumber = lastChapterNumber;
                            chapterName = chapterTitle;
                            volume = currentVolume;
                        }

                        const chapter = {
                            capitulo: isGlossary ? `Glossary ${glossaryCount}` :
                                isSpecialChapter ? `${chapterTitle} (${chapterNumber})` :
                                    `Vol. ${volume} Cap. ${chapterNumber}`,
                            name: chapterName,
                            url: chapterUrl,
                            index: chapterNumber,
                            volume: volume
                        };

                        // Criar ou atualizar o volume
                        if (!volumes[volume]) {
                            volumes[volume] = {
                                name: `Volume ${volume}`,
                                slug: `Volume-${volume}`,
                                chapters: []
                            };
                        }
                        volumes[volume].chapters.push(chapter);
                    });
                });
            });

            // Converter o objeto de volumes em array
            const volumesArray = Object.values(volumes).sort((a, b) => {
                const volA = parseInt(a.name.split(' ')[1]);
                const volB = parseInt(b.name.split(' ')[1]);
                return volA - volB;
            });

            return {
                title,
                coverUrl,
                author,
                status,
                rating: parseFloat(rating),
                ratingCount: parseInt(ratingCount),
                genres,
                tags,
                chapters: chapters.length,
                data: volumesArray
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

            // Get the chapter content container
            const chapterContainer = $('#chr-content, #chapter-content');

            // Remove divs containing script tags
            chapterContainer.find('div').each((_, element) => {
                if ($(element).find('script').length > 0) {
                    $(element).remove();
                }
            });

            // Remove divs with unlock-buttons class
            chapterContainer.find('div.unlock-buttons').remove();

            // Remove elements with btn btn-unlock btn-block class
            chapterContainer.find('.btn.btn-unlock.btn-block').remove();

            // Get the cleaned HTML content
            const chapterBody = chapterContainer.html();

            let processedContent = processImage ? await this.processImagesInContent(chapterBody) : chapterBody;
            return { content: processedContent.replace(/"/g, "'").replace(/\n/g, '').trim() };
        } catch (error) {
            console.error('Error downloading chapter body:', error.message);
            throw error;
        }
    }

    async getLatestReleases() {
        try {
            const { data } = await axios.get(`${this.baseUrl}sort/latest`);
            const $ = cheerio.load(data);
            const latestReleases = [];

            $('div.list-novel div.row').each((index, element) => {
                const url = $(element).find('h3.novel-title a').attr('href');
                let imageUrl = $(element).find('img.cover').attr('src') ||
                    $(element).find('img.cover').attr('data-src');
                
                // Process image URL to replace novel_200_89 with novel
                if (imageUrl) {
                    imageUrl = imageUrl.replace(/novel_\d+_\d+/, 'novel');
                }

                const title = $(element).find('h3.novel-title a').text().trim();
                const author = $(element).find('span.author').text().trim();
                const chapter = $(element).find('span.chr-text').text().trim();
                const isHot = $(element).find('span.label-hot').length > 0;

                // Only add to results if all required fields are present and not empty
                if (url && title && author && chapter) {
                    latestReleases.push({
                        url,
                        title,
                        author,
                        chapter,
                        imageUrl,
                        isHot
                    });
                }
            });

            return latestReleases;
        } catch (error) {
            console.error('Error getting latest releases:', error.message);
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
            return coverTag.attr('data-src') || coverTag.attr('src');
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
            url: $(element).attr('href') || $(element).val(),
        };
    }
}

module.exports = NovelFull;
