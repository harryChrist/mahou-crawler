const axios = require('axios');
const cheerio = require('cheerio');
const BaseProvider = require('@/template/BaseProvider');
const { URL } = require('url');

class AsuraComicProvider extends BaseProvider {
    constructor() {
        super('asuracomic', 'https://asuracomic.com', 'manga');
        this.searchUrl = `${this.baseUrl}/?s=%s`;
        this.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        };
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
        try {
            query = query.toLowerCase();
            const searchUrl = this.searchUrl.replace('%s', query);
            const { data } = await axios.get(searchUrl, { headers: this.headers });
            const $ = cheerio.load(data);

            const results = [];
            $('.bsx').each((i, element) => {
                const a = $(element).find('a');
                const imageURL = $(element).find('img').attr('src');
                results.push({
                    url: a.attr('href') ? this.getFullUrl(a.attr('href')) : '',
                    title: $(element).find('.tt').text().trim(),
                    imageURL: imageURL,
                });
            });

            return results;
        } catch (error) {
            console.error(`Error searching for series: ${error.message}`);
            return [];
        }
    }

    async readNovelInfo(novelUrl) {
        try {
            this.novelUrl = novelUrl;
            console.debug("Visiting", this.novelUrl);
            const { data } = await axios.get(this.novelUrl, { headers: this.headers });
            const $ = cheerio.load(data);

            // Extract title
            const titleTag = $('h1');
            let novelTitle = "";
            if (titleTag.length && titleTag.text().trim()) {
                novelTitle = titleTag.text().trim();
            } else {
                const headTitle = $('title');
                if (headTitle.length && headTitle.text().trim()) {
                    novelTitle = headTitle.text().split(' - ')[0].trim();
                } else {
                    novelTitle = "Unknown Work";
                }
            }

            // Extract cover
            const coverImg = $('img.series-cover').first() || $('img[alt*="cover" i]').first();
            let novelCover = '';
            if (coverImg && coverImg.attr('src')) {
                novelCover = new URL(coverImg.attr('src'), this.baseUrl).toString();
            }

            // Extract chapters
            const chapters = [];
            $('a[href*="/chapter/"]').each((i, element) => {
                let href = $(element).attr('href');
                if (!href.startsWith('/series/')) {
                    href = href.startsWith('/') ? `/series${href}` : `/series/${href}`;
                }
                
                const chapterUrl = new URL(href, this.baseUrl).toString();
                let chapterTitle = $(element).text().trim() || `Chapter ${chapterUrl.split('/').pop()}`;
                
                if (!chapterTitle.startsWith('Chapter')) {
                    chapterTitle = `Chapter ${chapterTitle}`;
                }
                
                const lastSegment = chapterUrl.split('/').pop();
                const chapterNumMatch = lastSegment.match(/(\d+\.?\d*)/);
                const chapterNum = chapterNumMatch ? parseFloat(chapterNumMatch[1]) : Infinity;
                
                chapters.push({
                    capitulo: chapterTitle,
                    name: chapterTitle,
                    url: chapterUrl,
                    index: chapterNum
                });
            });

            // Remove duplicates based on URL
            const uniqueChapters = Array.from(
                new Map(chapters.map(chapter => [chapter.url, chapter])).values()
            );
            
            // Sort chapters by number
            const sortedChapters = uniqueChapters.sort((a, b) => a.index - b.index);
            console.log(`Sorted chapters: ${sortedChapters.map(c => `${c.capitulo} (${c.index})`).join(', ')}`);

            // Create volume structure
            const volumes = [{
                name: "Chapters",
                slug: "chapters",
                chapters: sortedChapters
            }];

            const novelData = {
                title: novelTitle,
                coverUrl: novelCover,
                authors: ["Unknown"], // Asura doesn't reliably provide author info
                chapters: sortedChapters.length,
                volumes: volumes.length,
                data: volumes,
            };

            return novelData;
        } catch (error) {
            console.error("Error fetching novel info:", error.message);
            throw error;
        }
    }

    async downloadChapterBody(url, processImage = false) {
        try {
            const chapterUrl = this.getFullUrl(url);
            const { data } = await axios.get(chapterUrl, { headers: this.headers });
            const $ = cheerio.load(data);
            
            const chapterNumber = chapterUrl.split('/').pop();
            
            // Extract images using various methods
            let images = [];
            
            // Method 1: Look for images in scripts
            $('script').each((i, script) => {
                if (!$(script).html()) return;
                
                const scriptContent = $(script).html();
                if (scriptContent.includes('asuracomic.net')) {
                    // Look for ordered images
                    const orderedMatches = scriptContent.match(/"order":(\d+),"url":"(https:\/\/gg\.asuracomic\.net\/storage\/media\/\d+\/conversions\/[0-9A-Z]+-optimized\.[a-z]+)"/g);
                    if (orderedMatches) {
                        orderedMatches.forEach(match => {
                            const orderMatch = match.match(/"order":(\d+),"url":"([^"]+)"/);
                            if (orderMatch) {
                                const order = parseInt(orderMatch[1]);
                                const url = orderMatch[2];
                                images.push({ order, url });
                            }
                        });
                    }
                    
                    // Other patterns
                    const pattern1 = /(https:\/\/gg\.asuracomic\.net\/storage\/media\/\d+\/conversions\/\d+-(kopya-)?optimized\.[a-z]+)/g;
                    const pattern2 = /(https:\/\/gg\.asuracomic\.net\/storage\/media\/\d+\/conversions\/[0-9A-Z]+-optimized\.[a-z]+)/g;
                    
                    let matches = [...scriptContent.matchAll(pattern1), ...scriptContent.matchAll(pattern2)];
                    matches.forEach(match => {
                        if (match[0]) {
                            images.push({ order: Infinity, url: match[0] });
                        }
                    });
                }
            });
            
            // Method 2: Look for images in img tags
            $('img').each((i, img) => {
                const imgUrl = $(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-lazy-src');
                if (imgUrl && imgUrl.includes('gg.asuracomic.net/storage/media')) {
                    const fullUrl = new URL(imgUrl, this.baseUrl).toString();
                    if (!images.some(image => image.url === fullUrl)) {
                        images.push({ order: Infinity, url: fullUrl });
                    }
                }
            });
            
            // Method 3: Look in div backgrounds
            $('div[style*="background-image"]').each((i, div) => {
                const style = $(div).attr('style') || '';
                const urlMatch = style.match(/url\(['"']?(https:\/\/gg\.asuracomic\.net\/storage\/media\/[^'"')]+)['"']?\)/);
                if (urlMatch && urlMatch[1]) {
                    if (!images.some(image => image.url === urlMatch[1])) {
                        images.push({ order: Infinity, url: urlMatch[1] });
                    }
                }
            });
            
            // Filter duplicates and sort
            const uniqueImagesMap = new Map();
            images.forEach(image => {
                if (!uniqueImagesMap.has(image.url) || image.order < uniqueImagesMap.get(image.url).order) {
                    uniqueImagesMap.set(image.url, image);
                }
            });
            
            images = Array.from(uniqueImagesMap.values()).sort((a, b) => a.order - b.order);
            
            if (images.length === 0) {
                console.log("No images found in chapter.");
                return { content: "<div>No images found in chapter.</div>" };
            }
            
            console.log(`Found ${images.length} images in chapter ${chapterNumber}`);
            
            // Create HTML content with images
            let html = '<div class="chapter-content">';
            for (let i = 0; i < images.length; i++) {
                html += `<img src="${images[i].url}" alt="Page ${i+1}" class="mx-auto"/>`;
            }
            html += '</div>';
            
            return { content: html.replace(/"/g, "'").replace(/\n/g, '') };
        } catch (error) {
            console.error("Error downloading chapter:", error.message);
            return { content: `<div>Error: ${error.message}</div>` };
        }
    }
}

module.exports = new AsuraComicProvider(); 