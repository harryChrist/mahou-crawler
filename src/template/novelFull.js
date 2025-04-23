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
                dumpio: false
            });
            const page = await browser.newPage();

            // Extrair parâmetros da URL
            const url = new URL(novelUrl);
            const params = new URLSearchParams(url.search);
            
            // Opções de processamento de capítulos
            const chapterMode = params.get('mode') || '1'; // 1: auto, 2: sequential, 3: url, 4: title, 5: first_number
            const startNumber = parseInt(params.get('start_number')) || 1; // Número inicial para contagem sequencial

            // Navegar para a página
            await page.goto(this.getFullUrl(novelUrl) + '#tab-chapters-title', { waitUntil: 'networkidle0' });

            await Promise.all([
                page.waitForSelector('h3.title', { timeout: 30000 }),
                page.waitForSelector('.desc-text[itemprop="description"]', { timeout: 30000 }),
                page.waitForSelector('.panel-body .row', { timeout: 30000 }),
                page.waitForSelector('.book img', { timeout: 30000 })
            ]);

            // Extrair o HTML
            const content = await page.content();
            await browser.close();

            const $ = cheerio.load(content);

            // Função para analisar padrões de numeração
            const analyzeChapterPatterns = ($) => {
                const stats = {
                    totalChapters: 0,
                    urlNumbers: [],
                    titleNumbers: [],
                    urlPatterns: {},
                    titlePatterns: {},
                    inconsistencies: []
                };

                $('.panel-body .row').each((rowIndex, row) => {
                    $(row).find('.col-xs-12').each((colIndex, col) => {
                        $(col).find('.list-chapter li').each((index, element) => {
                            stats.totalChapters++;
                            const chapterTitle = $(element).find('a').attr('title') || $(element).find('.chapter-title').text().trim();
                            const chapterUrl = $(element).find('a').attr('href');

                            // Analisar números da URL
                            const urlMatch = chapterUrl.match(/chapter-(\d+)/i);
                            if (urlMatch) {
                                const urlNum = parseInt(urlMatch[1]);
                                stats.urlNumbers.push(urlNum);
                                stats.urlPatterns[urlNum] = (stats.urlPatterns[urlNum] || 0) + 1;
                            }

                            // Analisar números do título
                            const titleMatch = chapterTitle.match(/Chapter\s*(\d+)/i);
                            if (titleMatch) {
                                const titleNum = parseInt(titleMatch[1]);
                                stats.titleNumbers.push(titleNum);
                                stats.titlePatterns[titleNum] = (stats.titlePatterns[titleNum] || 0) + 1;
                            }

                            // Verificar inconsistências
                            if (urlMatch && titleMatch) {
                                const urlNum = parseInt(urlMatch[1]);
                                const titleNum = parseInt(titleMatch[1]);
                                if (urlNum !== titleNum) {
                                    stats.inconsistencies.push({
                                        chapter: chapterTitle,
                                        urlNumber: urlNum,
                                        titleNumber: titleNum
                                    });
                                }
                            }
                        });
                    });
                });

                // Calcular estatísticas
                stats.avgUrlNumber = stats.urlNumbers.length > 0 ? 
                    stats.urlNumbers.reduce((a, b) => a + b, 0) / stats.urlNumbers.length : 0;
                stats.avgTitleNumber = stats.titleNumbers.length > 0 ? 
                    stats.titleNumbers.reduce((a, b) => a + b, 0) / stats.titleNumbers.length : 0;

                stats.urlNumberRange = stats.urlNumbers.length > 0 ? 
                    Math.max(...stats.urlNumbers) - Math.min(...stats.urlNumbers) : 0;
                stats.titleNumberRange = stats.titleNumbers.length > 0 ? 
                    Math.max(...stats.titleNumbers) - Math.min(...stats.titleNumbers) : 0;

                return stats;
            };

            // Analisar padrões antes de processar
            const chapterStats = analyzeChapterPatterns($);

            const title = $('h3.title').first().text().trim();
            const coverUrl = $('.book img').attr('src') || $('.book img').attr('data-src');
            const author = $('.info-meta li:contains("Author:") a').text().trim();
            const status = $('.info-meta li:contains("Status:") a').text().trim();
            const rating = $('span[itemprop="ratingValue"]').text().trim();
            const ratingCount = $('span[itemprop="reviewCount"]').text().trim();
            const synopsis = $('.desc-text[itemprop="description"]').text().trim();

            const genres = [];
            $('.info-meta li:contains("Genre:") a').each((index, element) => {
                genres.push($(element).text().trim());
            });

            const tags = [];
            $('.tag-container a').each((index, element) => {
                tags.push($(element).text().trim());
            });

            const chapters = [];
            let lastChapterNumber = startNumber - 1;
            let volumes = {};
            let firstChapterNumber = null;

            // Determinar o modo de processamento
            let processingMode = chapterMode;
            if (chapterMode === '1') {
                // Usar estatísticas para determinar o melhor modo
                if (chapterStats.inconsistencies.length === 0 && 
                    chapterStats.urlNumbers.length > 0 && 
                    chapterStats.urlNumberRange === chapterStats.totalChapters - 1) {
                    processingMode = '3'; // URL numbers are consistent
                } else if (chapterStats.inconsistencies.length === 0 && 
                          chapterStats.titleNumbers.length > 0 && 
                          chapterStats.titleNumberRange === chapterStats.totalChapters - 1) {
                    processingMode = '4'; // Title numbers are consistent
                } else {
                    processingMode = '2'; // Fallback to sequential
                }
            }

            // Iterar sobre cada row no panel-body
            $('.panel-body .row').each((rowIndex, row) => {
                $(row).find('.col-xs-12').each((colIndex, col) => {
                    $(col).find('.list-chapter li').each((index, element) => {
                        const chapterTitle = $(element).find('a').attr('title') || $(element).find('.chapter-title').text().trim();
                        const chapterUrl = $(element).find('a').attr('href');

                        let chapterNumber;
                        let chapterName = '';
                        let volume = 0;

                        switch (processingMode) {
                            case '2':
                                // Contagem sequencial simples
                                lastChapterNumber++;
                                chapterNumber = lastChapterNumber;
                                chapterName = chapterTitle.replace(/^Chapter\s*\d+\s*[-–:]\s*/i, '').trim();
                                break;

                            case '3':
                                // Usar número da URL
                                const urlMatch = chapterUrl.match(/chapter-(\d+)/i);
                                chapterNumber = urlMatch ? parseInt(urlMatch[1]) : ++lastChapterNumber;
                                chapterName = chapterTitle.replace(/^Chapter\s*\d+\s*[-–:]\s*/i, '').trim();
                                break;

                            case '4':
                                // Usar número do título
                                const titleMatch = chapterTitle.match(/Chapter\s*(\d+)/i);
                                chapterNumber = titleMatch ? parseInt(titleMatch[1]) : ++lastChapterNumber;
                                chapterName = chapterTitle.replace(/^Chapter\s*\d+\s*[-–:]\s*/i, '').trim();
                                break;

                            case '5':
                                // Usar primeiro número encontrado (URL ou título)
                                const urlNum = chapterUrl.match(/chapter-(\d+)/i)?.[1];
                                const titleNum = chapterTitle.match(/Chapter\s*(\d+)/i)?.[1];
                                chapterNumber = urlNum ? parseInt(urlNum) : 
                                              titleNum ? parseInt(titleNum) : 
                                              ++lastChapterNumber;
                                chapterName = chapterTitle.replace(/^Chapter\s*\d+\s*[-–:]\s*/i, '').trim();
                                break;
                        }

                        const chapter = {
                            capitulo: `Vol. ${volume} Cap. ${chapterNumber}`,
                            name: chapterName,
                            url: chapterUrl,
                            index: chapterNumber,
                            volume: volume,
                            originalTitle: chapterTitle,
                            processingMode: processingMode
                        };

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
                synopsis,
                status,
                rating: parseFloat(rating),
                ratingCount: parseInt(ratingCount),
                genres,
                tags,
                chapters: chapters.length,
                data: volumesArray,
                mode: processingMode,
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
            // Make concurrent requests for all pages
            const [page1Response, page2Response, page3Response, page4Response] = await Promise.all([
                axios.get(`${this.baseUrl}sort/latest?page=1`),
                axios.get(`${this.baseUrl}sort/latest?page=2`),
                axios.get(`${this.baseUrl}sort/latest?page=3`),
                axios.get(`${this.baseUrl}sort/latest?page=4`)
            ]);

            const latestReleases = [];

            // Process all pages
            [page1Response.data, page2Response.data, page3Response.data, page4Response.data].forEach(data => {
                const $ = cheerio.load(data);
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
